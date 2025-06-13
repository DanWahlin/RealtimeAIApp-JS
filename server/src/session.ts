import { WebSocket, RawData } from 'ws';
import { Logger } from 'pino';
import { DefaultAzureCredential } from '@azure/identity';
import { OpenAIRealtimeWS } from 'openai/beta/realtime/ws';
import { config } from 'dotenv';
import * as crypto from 'crypto';
import { AudioMetrics, SystemMessage, WSMessage } from './types';
import { AzureOpenAI } from 'openai';
config({ path: '../.env' });

const {
  BACKEND,
  OPENAI_API_KEY,
  OPENAI_ENDPOINT,
  OPENAI_DEPLOYMENT,
  OPENAI_API_VERSION
} = process.env as Record<string, string>;

const SESSION_CONFIG = {
  modalities: ['text', 'audio'],
  voice: 'ash', // ash, coral, sage, shimmer, verse, alloy
  input_audio_format: 'pcm16',
  input_audio_transcription: { model: 'whisper-1' },
  turn_detection: { type: 'server_vad', threshold: 0.6, silence_duration_ms: 500 },
  tool_choice: 'auto',
};

const REALTIME_SERVER_EVENTS = {
  SessionCreated: 'session.created',
  SessionUpdated: 'session.updated',
  InputAudioBufferSpeechStarted: 'input_audio_buffer.speech_started',
  InputAudioBufferCommitted: 'input_audio_buffer.committed',
  InputAudioBufferCleared: 'input_audio_buffer.cleared',
  ResponseAudioDelta: 'response.audio.delta',
  ResponseAudioDone: 'response.audio.done',
  ResponseAudioTranscriptDelta: 'response.audio_transcript.delta',
  ResponseAudioTranscriptDone: 'response.audio_transcript.done',
  ResponseContentPartAdded: 'response.content_part.added',
  ResponseTextDelta: 'response.text.delta',
  ResponseTextDone: 'response.text.done',
  ResponseFunctionCall: 'response.function_call',
  ResponseFunctionCallDone: 'response.function_call.done',
  ResponseFunctionCallArgumentsDelta: 'response.function_call_arguments.delta',
  ResponseDone: 'response.done',
  Error: 'error',
  ConversationItemCreated: 'conversation.item.created',
  ConversationItemInputAudioTranscriptionCompleted: 'conversation.item.input_audio_transcription.completed',
  ConversationItemInputAudioTranscriptionFailed: 'conversation.item.input_audio_transcription.failed',
  ResponseCreated: 'response.created',
  RateLimitsUpdated: 'rate_limits.updated',
  ResponseOutputItemAdded: 'response.output_item.added',
  ResponseOutputItemDone: 'response.output_item.done',
  ResponseFunctionCallArgumentsDone: 'response.function_call_arguments.done',
};

export class RTSession {
  private readonly openAIWsUrl = 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17';
  private static tokenCache: { token: string, expires: number } | null = null;
  private static readonly TOKEN_REFRESH_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes before expiry

  private audioBufferQueue: Buffer[] = [];
  private audioBufferTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_INTERVAL_MS = 200;
  private readonly MAX_BUFFER_SIZE = 65536; // 64KB or 32768; // 32KB
  private readonly MAX_QUEUE_SIZE = 10;
  private currentBufferSize = 0;
  private audioMetrics: AudioMetrics = {
    totalBytesSent: 0,
    totalBatchesSent: 0,
    maxBatchSize: 0,
    lastSendTime: 0,
    droppedChunks: 0
  };

  private readonly sessionId = crypto.randomUUID();
  private openAIWs!: WebSocket;

  constructor(
    private readonly clientWs: WebSocket,
    private readonly logger: Logger,
    private systemMessage: SystemMessage | null
  ) {
    if (!this.systemMessage) throw new Error('🔥 System message is required');

    this.logger = logger.child({ sessionId: this.sessionId });
    this.logger.info({ message: this.systemMessage.message }, '✅ Init message received');
    this.initialize().catch((error) => this.logger.error({ error }, '🔥 Failed to initialize session'));
  }

  private async initialize() {
    this.openAIWs = await this.initializeRealtimeWebSocket();
    this.updateSessionInstructions();
    this.setupEventHandlers();
  }

  // public updateInitMessage(systemMessage: SystemMessage) {
  //   this.logger.info({ message: systemMessage.message }, 'Updating instructions');
  //   this.systemMessage = systemMessage;

  //   // Send the updated instructions to the OpenAI WebSocket
  //   this.updateSessionInstructions();
  // }

  private updateSessionInstructions() {
    if (this.openAIWs && this.openAIWs.readyState === WebSocket.OPEN && this.systemMessage) {
      this.openAIWs.send(JSON.stringify({
        type: 'session.update',
        session: {
          instructions: this.systemMessage.message,
          tools: this.systemMessage.tools,
          ...SESSION_CONFIG
        }
      }));
      this.logger.info('✅ Session configuration sent');
    } else {
      this.logger.warn('🔌 Cannot update session: WebSocket not open');
    }
  }

  private initializeRealtimeWebSocket(): Promise<WebSocket> {
    const url = BACKEND === 'azure'
      ? `${OPENAI_ENDPOINT}/openai/realtime?deployment=${OPENAI_DEPLOYMENT}&api-version=${OPENAI_API_VERSION}`
      : this.openAIWsUrl;

    this.logger.info(`🔌 Connecting to OpenAI WebSocket at ${url}`);

    return new Promise(async (resolve, reject) => {
      const headers = await this.getWebSocketHeaders();
      const openAIWs = new WebSocket(url, { headers });

      openAIWs.on('open', () => {
        this.logger.info('🟢 OpenAI WebSocket connection opened');
        resolve(openAIWs);
      });

      openAIWs.on('error', (error) => {
        console.log(error);
        reject(error);
      });
    });
  }

  private async initializeRealtimeAzureOpenAIWebSocket(): Promise<WebSocket> {
    const azureOpenAIClient = new AzureOpenAI({
        apiKey: OPENAI_API_KEY,
        apiVersion: OPENAI_API_VERSION,
        deployment: OPENAI_DEPLOYMENT,
        endpoint: OPENAI_ENDPOINT
    });
    return new Promise(async (resolve, reject) => {
      const openAISocketClient = await OpenAIRealtimeWS.azure(azureOpenAIClient);

      openAISocketClient.socket.on('open', () => {
        this.logger.info('🟢 OpenAI WebSocket connection opened');
        resolve(openAISocketClient.socket);
      });

      openAISocketClient.socket.on('error', (error) => {
        this.logger.error({ error }, `🔥 OpenAI WebSocket error: ${openAISocketClient.socket.url}`);
        reject(error);
      });
    });
  }

  private async getWebSocketHeaders(): Promise<{ [key: string]: string }> {
    if (BACKEND === 'azure') {
      const now = Date.now();

      // Use cached token if available and not near expiration
      if (RTSession.tokenCache &&
        RTSession.tokenCache.token &&
        RTSession.tokenCache.expires > now + RTSession.TOKEN_REFRESH_THRESHOLD_MS) {
        this.logger.info('✅ Azure access token retrieved from cache');
        return {
          Authorization: `Bearer ${RTSession.tokenCache.token}`,
          'OpenAI-Beta': 'realtime=v1'
        };
      }

      const token = await new DefaultAzureCredential().getToken(
        'https://cognitiveservices.azure.com/.default'
      );

      if (!token?.token) throw new Error('🔥 Failed to retrieve Azure access token');

      // Cache the token with expiration
      RTSession.tokenCache = {
        token: token.token,
        expires: now + (token.expiresOnTimestamp * 1000)
      };

      this.logger.info('✅ Azure access token retrieved successfully');
      return { Authorization: `Bearer ${token.token}`, 'OpenAI-Beta': 'realtime=v1' };
    }

    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    return { Authorization: `Bearer ${OPENAI_API_KEY}`, 'OpenAI-Beta': 'realtime=v1' };
  }

  private send(message: WSMessage) {
    if (this.clientWs.readyState === WebSocket.OPEN) {
      this.clientWs.send(JSON.stringify(message));
    }
  }

  private sendBinary(data: ArrayBuffer) {
    if (this.clientWs.readyState === WebSocket.OPEN) {
      this.clientWs.send(Buffer.from(data), { binary: true });
    }
  }

  private setupEventHandlers() {
    this.clientWs.on('message', (data: RawData, isBinary) => this.handleClientMessage(data, isBinary));
    this.clientWs.on('close', () => {
      this.logger.info('🔴 Client websocket closed');
      this.dispose();
    });
    this.clientWs.on('error', (error) => this.logger.error({ error }, '🔥 Client websocket error occurred'));

    this.openAIWs.on('message', (data) => this.handleRealtimeMessage(data));
    this.openAIWs.on('error', (error) => this.logger.error({ error }, '🔥 OpenAI realtime websocket error'));
    this.openAIWs.on('close', () => {
      this.logger.info('🔴 OpenAI realtime websocket closed');
      this.dispose();
    });
  }

  private handleRealtimeMessage(data: RawData) {
    try {
      const event = JSON.parse(data.toString());

      // Direct mapping of event types to handler functions using an object literal
      const handlerMap: Record<string, (event: any) => void> = {
        [REALTIME_SERVER_EVENTS.SessionCreated]: (event) => {
          this.logger.info({ session_id: event.session?.id }, '✅ Session created');
          this.send({ type: 'control', action: 'session_created', id: this.sessionId });
          // Send an automatic greeting once the session is created
          this.sendInitialGreeting();
        },
        [REALTIME_SERVER_EVENTS.SessionUpdated]: () =>
          this.logger.info('✅ Session configuration updated'),

        [REALTIME_SERVER_EVENTS.InputAudioBufferSpeechStarted]: () =>
          this.send({ type: 'control', action: 'speech_started' }),

        [REALTIME_SERVER_EVENTS.InputAudioBufferCommitted]: (event) => {
          if (event.transcript) {
            this.send({ type: 'transcription', text: event.transcript });
            this.logger.debug({ transcriptionLength: event.transcript.length }, '✅ Input audio processed successfully');
          }
        },

        [REALTIME_SERVER_EVENTS.InputAudioBufferCleared]: () =>
          this.logger.debug('✅ Input audio buffer cleared'),

        [REALTIME_SERVER_EVENTS.ResponseAudioDelta]: (event) => {
          if (event.delta) {
            this.sendBinary(Buffer.from(event.delta, 'base64'));
          }
        },

        [REALTIME_SERVER_EVENTS.ResponseAudioDone]: (event) =>
          this.logger.debug({ item_id: event.item_id }, '✅ Audio response completed'),

        [REALTIME_SERVER_EVENTS.ResponseAudioTranscriptDelta]: (event) => {
          if (event.delta) {
            const contentId = event.item_id || this.sessionId;
            this.send({ id: contentId, type: 'text_delta', delta: event.delta });
          }
        },

        [REALTIME_SERVER_EVENTS.ResponseAudioTranscriptDone]: (event) => {
          const contentId = event.item_id || this.sessionId;
          this.send({ type: 'control', action: 'text_done', id: contentId });
        },

        [REALTIME_SERVER_EVENTS.ResponseContentPartAdded]: (event) =>
          this.logger.debug({ item_id: event.item_id }, 'Content part added'),

        [REALTIME_SERVER_EVENTS.ResponseTextDelta]: (event) => {
          if (event.delta) {
            const contentId = event.item_id || this.sessionId;
            this.send({ id: contentId, type: 'text_delta', delta: event.delta });
          }
        },

        [REALTIME_SERVER_EVENTS.ResponseTextDone]: (event) => {
          const contentId = event.item_id || this.sessionId;
          this.send({ type: 'control', action: 'text_done', id: contentId });
        },

        [REALTIME_SERVER_EVENTS.ResponseFunctionCallArgumentsDelta]: () =>
          this.logger.debug('✅ Ignoring function call arguments delta for simplicity'),

        [REALTIME_SERVER_EVENTS.ResponseFunctionCallArgumentsDone]: (event) =>
          this.handleFunctionCallArgumentsDone(event),

        [REALTIME_SERVER_EVENTS.ResponseDone]: (event) =>
          this.logger.debug({ response_id: event.response?.id }, '✅ Response generation completed'),

        [REALTIME_SERVER_EVENTS.Error]: (event) =>
          this.logger.error({ error: event.error }, '🔥 Realtime API error'),

        [REALTIME_SERVER_EVENTS.ConversationItemCreated]: (event) =>
          this.logger.debug({ item: event.item }, '✅ Conversation item created'),

        [REALTIME_SERVER_EVENTS.ConversationItemInputAudioTranscriptionCompleted]: (event) =>
          this.logger.debug({ item_id: event.item_id, transcript: event.transcript }, '✅ Transcription completed'),

        [REALTIME_SERVER_EVENTS.ConversationItemInputAudioTranscriptionFailed]: (event) =>
          this.logger.error({ error: event.error }, '🔥 Transcription failed'),

        [REALTIME_SERVER_EVENTS.ResponseCreated]: () =>
          this.logger.debug('✅ Response created'),

        [REALTIME_SERVER_EVENTS.RateLimitsUpdated]: () =>
          this.logger.debug('✅ Rate limits updated'),

        [REALTIME_SERVER_EVENTS.ResponseOutputItemAdded]: () =>
          this.logger.debug('✅ Response output item added'),

        [REALTIME_SERVER_EVENTS.ResponseOutputItemDone]: () =>
          this.logger.debug('✅ Response output item done'),
      };

      // Direct O(1) lookup instead of searching through keys
      const handler = handlerMap[event.type];
      if (handler) {
        handler(event);
      } else {
        this.logger.debug({ type: event.type }, '🟠 Unhandled event type');
      }
    } catch (error) {
      this.logger.error({ error, message: data.toString() }, '🔥 Error processing realtime message');
    }
  }

  private sendInitialGreeting() {
    if (this.openAIWs?.readyState === WebSocket.OPEN) {
      this.logger.info(`🗣️ Sending initial greeting for ${this.systemMessage?.type}`);

      this.openAIWs.send(JSON.stringify({
        type: 'response.create',
        event_id: `greeting_${this.sessionId.substring(0, 8)}`,
        response: {
          modalities: ['text', 'audio'],
          voice: SESSION_CONFIG.voice,
          instructions: this.systemMessage?.initialInstructions
        }
      }));
    }
  }

  // 👋 Hello there! I'm your language learning assistant. What language would you like to learn today?

  private handleClientMessage(data: RawData, isBinary: boolean) {
    try {
      if (isBinary) {
        this.handleClientBinaryMessage(data);
      } else {
        this.handleClientTextMessage(data);
      }
    } catch (error) {
      this.logger.error({ error }, '🔥 Error handling message');
    }
  }

  private handleClientBinaryMessage(data: RawData) {
    if (this.openAIWs?.readyState !== WebSocket.OPEN) {
      this.logger.warn('🟠 Realtime WebSocket not open for binary message');
      return;
    }

    // Add to buffer queue and track size
    const audioBuffer = Buffer.from(data as ArrayBuffer);
    this.audioBufferQueue.push(audioBuffer);
    this.currentBufferSize += audioBuffer.length;

    // Flush immediately if buffer exceeds size threshold
    if (this.currentBufferSize > this.MAX_BUFFER_SIZE) {
      if (this.audioBufferTimer) {
        clearTimeout(this.audioBufferTimer);
        this.audioBufferTimer = null;
      }
      this.flushAudioBuffer();
      return;
    }

    // Schedule a flush if not already scheduled
    if (!this.audioBufferTimer) {
      this.audioBufferTimer = setTimeout(() => this.flushAudioBuffer(), this.BATCH_INTERVAL_MS);
    }
  }

  private flushAudioBuffer() {
    this.audioBufferTimer = null;

    // Skip if no data to send or connection issues
    if (this.audioBufferQueue.length === 0) return;
    if (!this.openAIWs || this.openAIWs.readyState !== WebSocket.OPEN) {
      this.clearAudioQueue();
      return;
    }

    try {
      // Handle backpressure if needed
      const bufferedAmount = (this.openAIWs as any)._socket?.bufferedAmount || 0;
      if (this.handleBackpressure(bufferedAmount)) return;

      // Prepare and send the combined audio buffer
      const totalSize = this.currentBufferSize;
      const combinedBuffer = this.combineAudioBuffers(totalSize);

      // Additional check to ensure combinedBuffer is not empty
      if (combinedBuffer.length === 0) {
        this.logger.warn('Combined buffer is empty after combination. Skipping send.');
        this.clearAudioQueue();
        return;
      }

      // Clear queue early to allow for new data accumulation
      this.clearAudioQueue();

      // Send the audio data and measure performance
      const sendStart = performance.now();
      this.sendAudioToOpenAI(combinedBuffer, totalSize);
      const sendDuration = performance.now() - sendStart;

      // Update metrics and log if significant
      this.updateAudioMetrics(totalSize, sendDuration);
    } catch (error) {
      this.logger.error({ error }, '🔥 Error while flushing audio buffer');
      this.clearAudioQueue();
    }
  }

  // Three focused helper methods that handle specific concerns
  private clearAudioQueue(): void {
    this.audioBufferQueue = [];
    this.currentBufferSize = 0;
  }

  private handleBackpressure(bufferedAmount: number): boolean {
    if (bufferedAmount <= 1_000_000) return false; // No backpressure

    // Calculate severity and trim queue if needed
    const severityFactor = Math.min(bufferedAmount / 2_000_000, 1);
    const effectiveQueueSize = Math.max(1, Math.floor(this.MAX_QUEUE_SIZE * (1 - severityFactor)));

    if (this.audioBufferQueue.length > effectiveQueueSize) {
      const droppedCount = this.audioBufferQueue.length - effectiveQueueSize;
      this.audioMetrics.droppedChunks += droppedCount;

      this.logger.warn(
        `🟠 WebSocket backpressure detected (${(bufferedAmount / 1024 / 1024).toFixed(2)}MB). ` +
        `Dropping ${droppedCount} oldest audio chunks.`
      );

      // Keep only the most recent chunks
      this.audioBufferQueue = this.audioBufferQueue.slice(-effectiveQueueSize);
      this.currentBufferSize = this.audioBufferQueue.reduce((size, buffer) => size + buffer.length, 0);
    }

    // Reschedule with adaptive delay
    const adaptiveDelay = 100 + Math.floor(severityFactor * 400);
    this.audioBufferTimer = setTimeout(() => this.flushAudioBuffer(), adaptiveDelay);
    return true;
  }

  private combineAudioBuffers(totalSize: number): Buffer {
    // Create a single buffer containing all audio chunks
    const combinedBuffer = Buffer.allocUnsafe(totalSize);

    let offset = 0;
    for (const buffer of this.audioBufferQueue) {
      buffer.copy(combinedBuffer, offset);
      offset += buffer.length;
    }

    return combinedBuffer;
  }

  private sendAudioToOpenAI(buffer: Buffer, totalSize: number): void {
    const audioData = buffer.toString('base64');

    if (audioData.length > 5_000_000) {
      this.logger.debug(`Sending large audio payload: ${(audioData.length / 1024 / 1024).toFixed(2)}MB`);
    }

    this.openAIWs.send(JSON.stringify({
      type: 'input_audio_buffer.append',
      audio: audioData
    }));
  }

  private updateAudioMetrics(size: number, duration: number): void {
    // Update metrics
    this.audioMetrics.totalBytesSent += size;
    this.audioMetrics.totalBatchesSent++;
    this.audioMetrics.maxBatchSize = Math.max(this.audioMetrics.maxBatchSize, size);
    this.audioMetrics.lastSendTime = duration;

    // Log only significant events
    if (size > 32768 || duration > 50) {
      this.logger.debug(
        `Sent batched audio: ${size} bytes in ${duration.toFixed(1)}ms` +
        (duration > 100 ? " (slow)" : "")
      );
    }
  }

  private logAudioMetrics() {
    if (this.audioMetrics.totalBatchesSent > 0) {
      const metrics = {
        totalSent: `${(this.audioMetrics.totalBytesSent / 1024 / 1024).toFixed(2)} MB`,
        batches: this.audioMetrics.totalBatchesSent,
        avgBatchSize: `${Math.round(this.audioMetrics.totalBytesSent / this.audioMetrics.totalBatchesSent)} bytes`,
        maxBatchSize: `${this.audioMetrics.maxBatchSize} bytes`,
        avgSendTime: `${(this.audioMetrics.lastSendTime).toFixed(1)} ms`,
      };

      if (this.audioMetrics.droppedChunks > 0) {
        (metrics as any).droppedChunks = this.audioMetrics.droppedChunks;
      }

      this.logger.info({ audioStats: metrics }, 'Audio transmission statistics');
    }
  }

  private handleClientTextMessage(data: RawData) {
    const parsed = JSON.parse(data.toString()) as WSMessage;
    this.logger.debug({ parsed }, '✅ Received client message');
    if (parsed.type === 'user_message' && this.openAIWs.readyState === WebSocket.OPEN) {
      this.openAIWs.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: parsed.text }] },
      }));
      this.openAIWs.send(JSON.stringify({ type: 'response.create' }));
      this.logger.debug('✅ User message processed successfully');
    }
  }

  private handleFunctionCallArgumentsDone({ call_id, arguments: args }: { call_id: string; arguments: string }) {
    try {
      this.logger.debug({ call_id, arguments: args }, '✅ Function call arguments completed');
      if (args) {
        this.send({
          type: 'control',
          action: 'function_call_output',
          id: call_id,
          functionCallParams: args
        });
      } else {
        this.logger.warn({ call_id }, '🟠 No arguments provided in function call arguments done event');
      }
    } catch (error) {
      this.logger.error({ error, call_id }, '🔥 Error processing completed function call arguments');
    }
  }

  private removeAllEventListeners() {
    // Remove all client WebSocket event listeners
    if (this.clientWs) {
      this.clientWs.removeAllListeners('message');
      this.clientWs.removeAllListeners('close');
      this.clientWs.removeAllListeners('error');
      this.logger.debug('✅ Removed client WebSocket event listeners');
    }

    // Remove all OpenAI WebSocket event listeners
    if (this.openAIWs) {
      this.openAIWs.removeAllListeners('message');
      this.openAIWs.removeAllListeners('close');
      this.openAIWs.removeAllListeners('error');
      this.logger.debug('✅ Removed OpenAI WebSocket event listeners');
    }
  }

  private close() {
    this.logger.info('🔄 Session closing');

    this.removeAllEventListeners();

    if (this.clientWs && this.clientWs.readyState !== WebSocket.CLOSED &&
      this.clientWs.readyState !== WebSocket.CLOSING) {
      this.clientWs.close();
    }

    if (this.openAIWs && this.openAIWs.readyState !== WebSocket.CLOSED &&
      this.openAIWs.readyState !== WebSocket.CLOSING) {
      this.openAIWs.close();
    }

    this.logger.info('🔴 Session closed successfully');
  }

  dispose() {
    this.logger.info('🔴 Disposing session');

    // Log audio metrics before disposal
    this.logAudioMetrics();

    // Clear any pending timers
    if (this.audioBufferTimer) {
      clearTimeout(this.audioBufferTimer);
      this.audioBufferTimer = null;
    }

    // Force flush any remaining audio data if connection is still open
    if (this.audioBufferQueue.length > 0 &&
      this.openAIWs &&
      this.openAIWs.readyState === WebSocket.OPEN) {
      try {
        this.logger.debug(`Flushing ${this.audioBufferQueue.length} remaining audio chunks (${this.currentBufferSize} bytes) before disposal`);
        this.flushAudioBuffer();
      } catch (error) {
        this.logger.debug('Error flushing final audio data during disposal');
      }
    }

    // Clear audio queue and reset size tracker
    this.audioBufferQueue = [];
    this.currentBufferSize = 0;

    // Close connections and remove event listeners
    this.close();

    // Allow garbage collection by nullifying references
    (this as any).openAIWs = null;
    (this as any).systemMessage = null;  // Changed from initMessage to systemMessage

    this.logger.info('🗑️ Session disposed');
    this.logger.flush();
  }
}