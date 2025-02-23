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

export class RTSession {
  private readonly sessionId = crypto.randomUUID();
  private readonly logger: Logger;
  private realtimeWs!: WebSocket;

  constructor(
    private readonly ws: WebSocket,
    logger: Logger,
    private readonly instructions: string
  ) {
    this.logger = logger.child({ sessionId: this.sessionId });
    this.logger.info({ instructions }, 'Instructions received');
    this.initialize().catch((error) => this.logger.error({ error }, 'Failed to initialize session'));
  }

  private async initialize() {
    this.realtimeWs = await this.initializeRealtimeWebSocket();
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
        // Removed 'connected' greeting to match original (commented out)
        resolve(ws);
      });
      ws.on('error', (error) => reject(error));
    });
  }

  private async getWebSocketHeaders(): Promise<{ [key: string]: string }> {
    if (BACKEND === 'azure') {
      const token = await new DefaultAzureCredential().getToken('https://cognitiveservices.azure.com/.default');
      if (!token?.token) throw new Error('Failed to retrieve Azure access token');
      this.logger.debug('Azure access token retrieved successfully');
      return { Authorization: `Bearer ${token.token}`, 'OpenAI-Beta': 'realtime=v1' };
    }
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    return { Authorization: `Bearer ${OPENAI_API_KEY}`, 'OpenAI-Beta': 'realtime=v1' };
  }

  private send(message: WSMessage) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private sendBinary(data: ArrayBuffer) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(Buffer.from(data), { binary: true });
  }

  private setupEventHandlers() {
    this.ws.on('message', (data: RawData, isBinary) => this.handleClientMessage(data, isBinary));
    this.ws.on('close', () => this.close());
    this.ws.on('error', (error) => this.logger.error({ error }, 'WebSocket error occurred'));

    this.realtimeWs.on('message', (data) => this.handleRealtimeMessage(data));
    this.realtimeWs.on('error', (error) => this.logger.error({ error }, 'Realtime WebSocket error'));
    this.realtimeWs.on('close', () => this.logger.info('Realtime WebSocket closed'));
  }

  private handleRealtimeMessage(data: RawData) {
    try {
      const event = JSON.parse(data.toString());
      // this.logger.debug({ event }, 'Received realtime event');

      const handlers: { [key: string]: () => void } = {
        'session.created': () => this.logger.info({ session_id: event.session?.id }, 'Session created'),
        'session.updated': () => this.logger.info('Session configuration updated'),
        'input_audio_buffer.speech_started': () => this.send({ type: 'control', action: 'speech_started' }),
        'input_audio_buffer.committed': () => {
          if (event.transcript) {
            this.send({ type: 'transcription', text: event.transcript });
            this.logger.debug({ transcriptionLength: event.transcript.length }, 'Input audio processed successfully');
          }
        },
        'input_audio_buffer.cleared': () => this.logger.debug('Input audio buffer cleared'),
        'response.audio.delta': () => event.delta && this.sendBinary(Buffer.from(event.delta, 'base64')),
        'response.audio.done': () => this.logger.debug({ item_id: event.item_id }, 'Audio response completed'),
        'response.audio_transcript.delta': () => {
          if (event.delta) {
            const contentId = event.item_id || this.sessionId;
            this.send({ id: contentId, type: 'text_delta', delta: event.delta });
          }
        },
        'response.audio_transcript.done': () => {
          const contentId = event.item_id || this.sessionId;
          this.send({ type: 'control', action: 'text_done', id: contentId });
        },
        'response.text.delta': () => {
          if (event.delta) {
            const contentId = event.item_id || this.sessionId;
            this.send({ id: contentId, type: 'text_delta', delta: event.delta });
          }
        },
        'response.text.done': () => {
          const contentId = event.item_id || this.sessionId;
          this.send({ type: 'control', action: 'text_done', id: contentId });
        },
        'response.function_call': () => this.handleFunctionCall(event),
        'response.done': () => this.logger.debug({ response_id: event.response?.id }, 'Response generation completed'),
        'error': () => this.logger.error({ error: event.error }, 'Realtime API error'),
      };

      const handler = handlers[event.type];
      if (handler) handler();
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
    if (this.realtimeWs.readyState === WebSocket.OPEN) {
      const audioData = Buffer.from(data as ArrayBuffer).toString('base64');
      this.realtimeWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: audioData }));
    } else {
      this.logger.warn('Realtime WebSocket not open for binary message');
    }
  }

  private handleTextMessage(data: RawData) {
    const parsed = JSON.parse(data.toString()) as WSMessage;
    this.logger.debug({ parsed }, 'Received client message');
    if (parsed.type === 'user_message' && this.realtimeWs.readyState === WebSocket.OPEN) {
      this.realtimeWs.send(JSON.stringify({
        type: 'conversation.item.create',
        item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: parsed.text }] },
      }));
      this.realtimeWs.send(JSON.stringify({ type: 'response.create' }));
      this.logger.debug('User message processed successfully');
    }
  }

  private close() {
    this.logger.info('Session closing');
    if (this.realtimeWs.readyState !== WebSocket.CLOSED) this.realtimeWs.close();
    this.logger.info('Session closed successfully');
  }

  private handleFunctionCall({ name, arguments: args }: { name: string; arguments: string; call_id: string }) {
    const params = JSON.parse(args);
    this.logger.debug({ funcName: name, params }, 'Function call received');
    // Original code only logs; no response sent, so we align with that behavior here
  }
}