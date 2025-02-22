import { WebSocket, RawData } from 'ws';
import { Logger } from 'pino';
import { DefaultAzureCredential } from '@azure/identity';
import { config } from 'dotenv';
import * as crypto from 'crypto';
config({ path: '../.env' });

// Simplified message types using discriminated unions
type WSMessage =
  | { id: string; type: 'text_delta'; delta: string }
  | { id?: string; type: 'transcription'; text: string }
  | { id: string; type: 'user_message'; text: string }
  | { type: 'control'; action: 'speech_started' | 'connected' | 'text_done'; greeting?: string; id?: string };

const {
  BACKEND = 'openai', // Default to OpenAI if not set
  OPENAI_API_KEY,
  OPENAI_ENDPOINT,
  OPENAI_DEPLOYMENT,
} = process.env as Record<string, string>;

// Session configuration (extracted for reusability and clarity)
const SESSION_CONFIG = {
  modalities: ['text', 'audio'],
  voice: 'alloy',
  input_audio_format: 'pcm16',
  input_audio_transcription: { model: 'whisper-1' },
  turn_detection: { type: 'server_vad', threshold: 0.4, silence_duration_ms: 600 },
  tools: [
    {
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
    },
  ],
  tool_choice: 'auto',
};

export class RTSession {
  private readonly sessionId = crypto.randomUUID();
  private readonly logger: Logger;

  constructor(
    private readonly ws: WebSocket,
    logger: Logger,
    private readonly instructions: string,
    private readonly realtimeWs = new WebSocket('', { headers: {} }) // Placeholder, initialized asynchronously
  ) {
    this.logger = logger.child({ sessionId: this.sessionId });
    this.logger.info({ instructions }, 'Instructions received');
    this.initialize().catch((error) => this.logger.error({ error }, 'Failed to initialize session'));
  }

  private async initialize() {
    Object.assign(this.realtimeWs, await this.initializeRealtimeWebSocket());
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
        this.send({ type: 'control', action: 'connected', greeting: 'Connected to OpenAI Realtime API' });
        resolve(ws);
      });
      ws.on('error', reject);
    });
  }

  private async getWebSocketHeaders(): Promise<{ [key: string]: string }> {
    if (BACKEND === 'azure') {
      const token = await new DefaultAzureCredential().getToken('https://cognitiveservices.azure.com/.default');
      if (!token?.token) throw new Error('Failed to retrieve Azure access token');
      this.logger.debug('Azure access token retrieved successfully');
      return { Authorization: `Bearer ${token.token}`, 'OpenAI-Beta': 'realtime=v1' };
    }
    return { Authorization: `Bearer ${OPENAI_API_KEY}`, 'OpenAI-Beta': 'realtime=v1' };
  }

  private send(message: WSMessage) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private sendBinary(message: ArrayBuffer) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(Buffer.from(message), { binary: true });
  }

  private setupEventHandlers() {
    this.ws.on('message', (data: RawData, isBinary) => this.handleClientMessage(data, isBinary));
    this.ws.on('close', () => this.close());
    this.ws.on('error', (error) => this.logger.error({ error }, 'Client WebSocket error'));

    this.realtimeWs.on('message', (data) => this.handleRealtimeMessage(data));
    this.realtimeWs.on('error', (error) => this.logger.error({ error }, 'Realtime WebSocket error'));
    this.realtimeWs.on('close', () => this.logger.info('Realtime WebSocket closed'));
  }

  private handleRealtimeMessage(data: RawData) {
    const event = JSON.parse(data.toString());
    this.logger.debug({ event }, 'Received realtime event');

    const handlers: { [key: string]: () => void } = {
      'session.created': () => this.logger.info({ session_id: event.session.id }, 'Session created'),
      'session.updated': () => this.logger.info('Session configuration updated'),
      'input_audio_buffer.speech_started': () => this.send({ type: 'control', action: 'speech_started' }),
      'input_audio_buffer.committed': () => event.transcript && this.send({ type: 'transcription', text: event.transcript }),
      'input_audio_buffer.cleared': () => this.logger.debug('Input audio buffer cleared'),
      'response.audio.delta': () => event.delta && this.sendBinary(Buffer.from(event.delta, 'base64')),
      'response.audio.done': () => this.logger.debug({ item_id: event.item_id }, 'Audio response completed'),
      'response.audio_transcript.delta': () => event.delta && this.send({ id: event.item_id || this.sessionId, type: 'text_delta', delta: event.delta }),
      'response.audio_transcript.done': () => this.send({ type: 'control', action: 'text_done', id: event.item_id || this.sessionId }),
      'response.text.delta': () => event.delta && this.send({ id: event.item_id || this.sessionId, type: 'text_delta', delta: event.delta }),
      'response.text.done': () => this.send({ type: 'control', action: 'text_done', id: event.item_id || this.sessionId }),
      'response.function_call': () => this.handleFunctionCall(event),
      'response.done': () => this.logger.debug({ response_id: event.response.id }, 'Response generation completed'),
      'error': () => this.logger.error({ error: event.error }, 'Realtime API error'),
    };

    handlers[event.type]?.() ?? this.logger.debug({ type: event.type }, 'Unhandled event type');
  }

  private handleClientMessage(data: RawData, isBinary: boolean) {
    if (isBinary && this.realtimeWs.readyState === WebSocket.OPEN) {
      this.realtimeWs.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: Buffer.from(data as ArrayBuffer).toString('base64') }));
      return;
    }

    const parsed = JSON.parse(data.toString()) as WSMessage;
    this.logger.debug({ parsed }, 'Received client message');

    if (parsed.type === 'user_message' && this.realtimeWs.readyState === WebSocket.OPEN) {
      this.realtimeWs.send(JSON.stringify({ type: 'conversation.item.create', item: { type: 'message', role: 'user', content: [{ type: 'input_text', text: parsed.text }] } }));
      this.realtimeWs.send(JSON.stringify({ type: 'response.create' }));
    }
  }

  private close() {
    this.logger.info('Session closing');
    if (this.realtimeWs.readyState !== WebSocket.CLOSED) this.realtimeWs.close();
  }

  private handleFunctionCall({ name, arguments: args, call_id }: { name: string; arguments: string; call_id: string }) {
    if (name !== 'get_json_object' || this.realtimeWs.readyState !== WebSocket.OPEN) return;

    const params = JSON.parse(args);
    this.realtimeWs.send(JSON.stringify({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id, output: JSON.stringify(params) },
    }));
  }
}