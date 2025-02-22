import { WebSocket, RawData } from 'ws';
import { Logger } from 'pino';
import { DefaultAzureCredential } from '@azure/identity';
import { config } from 'dotenv';
import * as crypto from 'crypto';
config({ path: '../.env' });

type WSMessage =
  | { id: string; type: 'text_delta'; delta: string }
  | { id?: string; type: 'transcription'; text: string }
  | { id: string; type: 'user_message'; text: string }
  | { type: 'control'; action: 'speech_started' | 'connected' | 'text_done'; greeting?: string; id?: string };

// Function call response type for clarity
interface FunctionCallResponse {
  type: 'function_call_output';
  call_id: string;
  output: string;
}

const { BACKEND = 'openai', OPENAI_API_KEY, OPENAI_ENDPOINT, OPENAI_DEPLOYMENT } = process.env as Record<string, string>;

const SESSION_CONFIG = {
  modalities: ['text', 'audio'],
  voice: 'alloy',
  input_audio_format: 'pcm16',
  input_audio_transcription: { model: 'whisper-1' },
  turn_detection: { type: 'server_vad', threshold: 0.4, silence_duration_ms: 600 },
  tools: [{
    type: 'function',
    name: 'get_json_object',
    description: 'Converts text into a JSON object based upon a JSON schema',
    parameters: {
      type: 'object',
      properties: {
        tab: { type: 'string' },
        information: { type: 'object', properties: { name: { type: 'string' }, dob: { type: 'string' }, gender: { type: 'string' } }, required: ['name', 'dob', 'gender'] },
        symptoms: { type: 'array', items: { type: 'object', properties: { id: { type: 'number' }, description: { type: 'string' }, duration: { type: 'string' }, severity: { type: 'number' } }, required: ['id', 'description', 'duration', 'severity'] } },
        vitals: { type: 'object', properties: { temperature: { type: 'number' }, bloodPressure: { type: 'string' }, heartRate: { type: 'number' } }, required: ['temperature', 'bloodPressure', 'heartRate'] },
      },
      required: ['tab', 'information', 'symptoms', 'vitals'],
    },
  }],
  tool_choice: 'auto',
};

// Define server event types as a const object
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
} as const;

export class RTSession {
  private readonly sessionId = crypto.randomUUID();
  private readonly logger: Logger;
  private openAIWs!: WebSocket;

  constructor(
    private readonly clientWs: WebSocket,
    logger: Logger,
    private readonly instructions: string
  ) {
    this.logger = logger.child({ sessionId: this.sessionId });
    this.logger.info({ instructions }, 'Instructions received');
    this.initialize().catch((error) => this.logger.error({ error }, 'Failed to initialize session'));
  }

  private async initialize() {
    this.openAIWs = await this.initializeRealtimeWebSocket();
    this.setupEventHandlers();
    this.logger.info('New session created');
  }

  private initializeRealtimeWebSocket(): Promise<WebSocket> {
    const url = BACKEND === 'azure'
      ? `${OPENAI_ENDPOINT}/openai/realtime?deployment=${OPENAI_DEPLOYMENT}&api-version=2024-10-01-preview`
      : 'wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-10-01';

    return new Promise(async (resolve, reject) => {
      const headers = await this.getWebSocketHeaders();
      const ws = new WebSocket(url, { headers });
      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'session.update', session: { instructions: this.instructions, ...SESSION_CONFIG } }));
        resolve(ws);
      });
      ws.on('error', (error) => reject(error));
    });
  }

  private async getWebSocketHeaders(): Promise<{ [key: string]: string }> {
    if (BACKEND === 'azure') {
      const token = await new DefaultAzureCredential().getToken('https://cognitiveservices.azure.com/.default');
      if (!token?.token) throw new Error('Failed to retrieve Azure access token');
      this.logger.info('Azure access token retrieved successfully');
      return { Authorization: `Bearer ${token.token}`, 'OpenAI-Beta': 'realtime=v1' };
    }
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    return { Authorization: `Bearer ${OPENAI_API_KEY}`, 'OpenAI-Beta': 'realtime=v1' };
  }

  private send(message: WSMessage) {
    if (this.clientWs.readyState === WebSocket.OPEN) this.clientWs.send(JSON.stringify(message));
  }

  private sendBinary(data: ArrayBuffer) {
    if (this.clientWs.readyState === WebSocket.OPEN) this.clientWs.send(Buffer.from(data), { binary: true });
  }

  private sendFunctionCallOutput(call_id: string, output: string) {
    if (this.openAIWs.readyState === WebSocket.OPEN) {
      this.openAIWs.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'function_call_output', call_id, output },
      }));
      this.logger.debug({ call_id, output }, 'Sent function call output');
    } else {
      this.logger.warn({ call_id }, 'Cannot send function call output: Realtime WebSocket not open');
    }
  }

  private setupEventHandlers() {
    this.clientWs.on('message', (data: RawData, isBinary) => this.handleClientMessage(data, isBinary));
    this.clientWs.on('close', () => this.close());
    this.clientWs.on('error', (error) => this.logger.error({ error }, 'WebSocket error occurred'));

    this.openAIWs.on('message', (data) => this.handleRealtimeMessage(data));
    this.openAIWs.on('error', (error) => this.logger.error({ error }, 'Realtime WebSocket error'));
    this.openAIWs.on('close', () => this.logger.info('Realtime WebSocket closed'));
  }

  private handleRealtimeMessage(data: RawData) {
    try {
      const event = JSON.parse(data.toString());
      // this.logger.debug({ event }, 'Received realtime event');

      const handlers: Partial<Record<keyof typeof REALTIME_SERVER_EVENTS, (event: any) => void>> = {
        SessionCreated: () => this.logger.info({ session_id: event.session?.id }, 'Session created'),
        SessionUpdated: () => this.logger.info('Session configuration updated'),
        InputAudioBufferSpeechStarted: () => this.send({ type: 'control', action: 'speech_started' }),
        InputAudioBufferCommitted: () => {
          if (event.transcript) {
            this.send({ type: 'transcription', text: event.transcript });
            this.logger.debug({ transcriptionLength: event.transcript.length }, 'Input audio processed successfully');
          }
        },
        InputAudioBufferCleared: () => this.logger.debug('Input audio buffer cleared'),
        ResponseAudioDelta: () => event.delta && this.sendBinary(Buffer.from(event.delta, 'base64')),
        ResponseAudioDone: () => this.logger.debug({ item_id: event.item_id }, 'Audio response completed'),
        ResponseAudioTranscriptDelta: () => {
          if (event.delta) {
            const contentId = event.item_id || this.sessionId;
            this.send({ id: contentId, type: 'text_delta', delta: event.delta });
          }
        },
        ResponseAudioTranscriptDone: () => {
          const contentId = event.item_id || this.sessionId;
          this.send({ type: 'control', action: 'text_done', id: contentId });
        },
        ResponseContentPartAdded: () => this.logger.debug({ item_id: event.item_id }, 'Content part added'),
        ResponseTextDelta: () => {
          if (event.delta) {
            const contentId = event.item_id || this.sessionId;
            this.send({ id: contentId, type: 'text_delta', delta: event.delta });
          }
        },
        ResponseTextDone: () => {
          const contentId = event.item_id || this.sessionId;
          this.send({ type: 'control', action: 'text_done', id: contentId });
        },
        ResponseFunctionCall: (event: any) => this.handleFunctionCall(event),
        ResponseFunctionCallDone: (event: any) => this.handleFunctionCallDone(event),
        ResponseDone: () => this.logger.debug({ response_id: event.response?.id }, 'Response generation completed'),
        Error: () => this.logger.error({ error: event.error }, 'Realtime API error'),
        ConversationItemCreated: () => this.logger.debug({ item: event.item }, 'Conversation item created'),
        ConversationItemInputAudioTranscriptionCompleted: () => this.logger.debug({ item_id: event.item_id, transcript: event.transcript }, 'Transcription completed'),
        ConversationItemInputAudioTranscriptionFailed: () => this.logger.error({ error: event.error }, 'Transcription failed'),
      };

      // Map the incoming event.type to the corresponding key in REALTIME_SERVER_EVENTS
      const eventKey = (Object.keys(REALTIME_SERVER_EVENTS) as (keyof typeof REALTIME_SERVER_EVENTS)[])
        .find(key => REALTIME_SERVER_EVENTS[key] === event.type);
      const handler = eventKey ? handlers[eventKey] : undefined;

      if (handler) handler(event);
      else this.logger.debug({ type: event.type }, 'Unhandled event type');
    } catch (error) {
      this.logger.error({ error, message: data.toString() }, 'Error processing realtime message');
    }
  }

  private handleClientMessage(data: RawData, isBinary: boolean) {
    try {
      if (isBinary) {
        this.handleBinaryMessage(data);
      } else {
        this.handleTextMessage(data);
      }
    } catch (error) {
      this.logger.error({ error }, 'Error handling message');
    }
  }

  private handleBinaryMessage(data: RawData) {
    if (this.openAIWs.readyState === WebSocket.OPEN) {
      const audioData = Buffer.from(data as ArrayBuffer).toString('base64');
      this.openAIWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: audioData }));
    } else {
      this.logger.warn('Realtime WebSocket not open for binary message');
    }
  }

  private handleTextMessage(data: RawData) {
    const parsed = JSON.parse(data.toString()) as WSMessage;
    this.logger.debug({ parsed }, 'Received client message');
    if (parsed.type === 'user_message' && this.openAIWs.readyState === WebSocket.OPEN) {
      this.openAIWs.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: parsed.text }] },
      }));
      this.openAIWs.send(JSON.stringify({ type: 'response.create' }));
      this.logger.debug('User message processed successfully');
    }
  }

  private close() {
    this.logger.info('Session closing');
    if (this.openAIWs.readyState !== WebSocket.CLOSED) this.openAIWs.close();
    this.logger.info('Session closed successfully');
  }

  private handleFunctionCall({ name, call_id }: { name: string; call_id: string }) {
    try {
      this.logger.debug({ funcName: name, call_id }, 'Function call received');
      // Do nothing here — wait for ResponseFunctionCallDone for the complete arguments
    } catch (error) {
      this.logger.error({ error, call_id }, 'Error processing function call');
    }
  }

  private handleFunctionCallDone({ call_id, arguments: args }: { call_id: string; arguments: string }) {
    try {
      this.logger.debug({ call_id, arguments: args }, 'Function call completed with arguments');
      if (args) {
        const params = JSON.parse(args);
        this.sendFunctionCallOutput(call_id, JSON.stringify(params));
      } else {
        this.logger.warn({ call_id }, 'No arguments provided in function call done event');
      }
    } catch (error) {
      this.logger.error({ error, call_id }, 'Error processing completed function call');
    }
  }
}