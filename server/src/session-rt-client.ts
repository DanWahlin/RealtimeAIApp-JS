import { WebSocket } from 'ws';
import {
  isFunctionCallItem,
  RTClient,
  RTResponse,
  RTInputAudioItem,
  RTTextContent,
  RTAudioContent,
} from 'rt-client';
import { DefaultAzureCredential, getBearerTokenProvider } from '@azure/identity';
import { AzureKeyCredential } from '@azure/core-auth';
import { Logger } from 'pino';
import { config } from "dotenv";
config({ path: '../.env' });

interface TextDelta {
  id: string;
  type: 'text_delta';
  delta: string;
}

interface Transcription {
  id?: string;
  type: 'transcription';
  text: string;
}

interface UserMessage {
  id: string;
  type: 'user_message';
  text: string;
}

interface SpeechStarted {
  type: 'control';
  action: 'speech_started';
}

interface Connected {
  type: 'control';
  action: 'connected';
  greeting: string;
}

interface TextDone {
  type: 'control';
  action: 'text_done';
  id: string;
}

type ControlMessage = SpeechStarted | Connected | TextDone;

type WSMessage = TextDelta | Transcription | UserMessage | ControlMessage;

const {
  BACKEND,
  OPENAI_API_KEY,
  OPENAI_ENDPOINT,
  OPENAI_DEPLOYMENT
} = process.env as Record<string, string>;

export class RTSession {
  private rtClient!: RTClient;
  private ws: WebSocket;
  private readonly sessionId: string;
  private logger: Logger;
  private instructions: string;

  constructor(ws: WebSocket, logger: Logger, instructions: string) {
    this.sessionId = crypto.randomUUID();
    this.ws = ws;
    this.logger = logger.child({ sessionId: this.sessionId });
    this.instructions = instructions;
    logger.info({ instructions }, 'Instructions received');
    this.initialize();
  }

  async initialize() {
    this.rtClient = this.initializeClient();
    this.setupEventHandlers();
    this.logger.info('New session created');
    await this.rtClient.configure({
      instructions: this.instructions,
      modalities: ['text', 'audio'],
      voice: 'alloy', // "alloy" | "ash" | "ballad" | "coral" | "echo" | "sage" | "shimmer" | "verse"
      input_audio_format: 'pcm16',
      input_audio_transcription: {
        model: 'whisper-1',
      },
      turn_detection: {
        threshold: 0.4,
        silence_duration_ms: 600,
        type: 'server_vad',
      },
      tools: [
        {
          type: 'function',
          name: 'get_json_object',
          description: 'Converts text into a JSON object based upon a JSON schema',
          parameters: {
            type: 'object',
            properties: {
              tab: { type: 'string' },
              information: {
                type: 'object',
                properties: {
                  name: { type: 'string' },
                  dob: { type: 'string' },
                  gender: { type: 'string' }
                },
                required: ['name', 'dob', 'gender']
              },
              symptoms: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    id: { type: 'number' },
                    description: { type: 'string' },
                    duration: { type: 'string' },
                    severity: { type: 'number' }
                  },
                  required: ['id', 'description', 'duration', 'severity']
                }
              },
              vitals: {
                type: 'object',
                properties: {
                  temperature: { type: 'number' },
                  bloodPressure: { type: 'string' },
                  heartRate: { type: 'number' }
                },
                required: ['temperature', 'bloodPressure', 'heartRate']
              }
            },
            required: ['tab', 'information', 'symptoms', 'vitals']
          }
        }
      ],
      tool_choice: "auto"
    });

    // Send greeting
    // const greeting: Connected = {
    //   type: 'control',
    //   action: 'connected',
    //   greeting: 'You are now connected to the expressjs server',
    // };
    // this.send(greeting);
    this.logger.debug('Realtime session configured successfully');
    this.startEventLoop();
  }

  private send(message: WSMessage) {
    this.ws.send(JSON.stringify(message));
  }

  private sendBinary(message: ArrayBuffer) {
    this.ws.send(Buffer.from(message), { binary: true });
  }

  private initializeClient(): RTClient {
    this.logger.info(`Initializing RT client for backend: ${BACKEND}`);
  
    try {
      if (BACKEND === 'azure') {
        const credential = new DefaultAzureCredential();
        this.logger.info('DefaultAzureCredential created');
  
        // Log the environment variables to ensure they are set correctly
        this.logger.info({
          OPENAI_API_KEY,
          OPENAI_ENDPOINT,
          OPENAI_DEPLOYMENT
        }, 'Environment variables');
  
        // Attempt to acquire a token and log the result
        credential.getToken("https://cognitiveservices.azure.com/.default").then(token => {
          this.logger.debug('Token acquired', { token });
        }).catch(error => {
          this.logger.error('Error acquiring token', { error });
        });
  
        return new RTClient(
          new URL(OPENAI_ENDPOINT!),
          new DefaultAzureCredential(),
          { deployment: OPENAI_DEPLOYMENT! },
        );
      }
      return new RTClient(new AzureKeyCredential(OPENAI_API_KEY!), {
        model: OPENAI_DEPLOYMENT!,
      });
    } catch (error) {
      this.logger.error({ error }, 'Error initializing RT client');
      throw error;
    }
  }

  private setupEventHandlers() {
    this.logger.debug('Client configured successfully');

    this.ws.on('message', this.handleMessage.bind(this));
    this.ws.on('close', this.handleClose.bind(this));
    this.ws.on('error', (error) => {
      this.logger.error({ error }, 'WebSocket error occurred');
    });
  }

  private async handleMessage(message: Buffer, isBinary: boolean) {
    try {
      if (isBinary) {
        await this.handleBinaryMessage(message);
      } 
      else {
        await this.handleTextMessage(message);
      }
    } 
    catch (error) {
      this.logger.error({ error }, 'Error handling message');
    }
  }

  private async handleBinaryMessage(message: Buffer) {
    try {
      await this.rtClient.sendAudio(new Uint8Array(message));
    } 
    catch (error) {
      this.logger.error({ error }, 'Failed to send audio data');
      throw error;
    }
  }

  private async handleTextMessage(message: Buffer) {
    const messageString = message.toString('utf-8');
    const parsed: WSMessage = JSON.parse(messageString);

    this.logger.debug({ parsed }, 'Received text message');

    if (parsed.type === 'user_message') {
      try {
        await this.rtClient.sendItem({
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: parsed.text }],
        });
        await this.rtClient.generateResponse();
        this.logger.debug('User message processed successfully');
      } catch (error) {
        this.logger.error({ error }, 'Failed to process user message');
        throw error;
      }
    }
  }

  private async handleClose() {
    this.logger.info('Session closing');
    try {
      await this.rtClient.close();
      this.logger.info('Session closed successfully');
    } catch (error) {
      this.logger.error({ error }, 'Error closing session');
    }
  }

  private async handleTextContent(content: RTTextContent) {
    try {
      const contentId = `${content.itemId}-${content.contentIndex}`;
      for await (const text of content.textChunks()) {
        const deltaMessage: TextDelta = {
          id: contentId,
          type: 'text_delta',
          delta: text,
        };
        this.send(deltaMessage);
      }
      this.send({ type: 'control', action: 'text_done', id: contentId });
      this.logger.debug('Text content processed successfully');
    } catch (error) {
      this.logger.error({ error }, 'Error handling text content');
      throw error;
    }
  }

  private async handleAudioContent(content: RTAudioContent) {
    const handleAudioChunks = async () => {
      for await (const chunk of content.audioChunks()) {
        this.sendBinary(chunk.buffer);
      }
    };
    const handleAudioTranscript = async () => {
      const contentId = `${content.itemId}-${content.contentIndex}`;
      for await (const chunk of content.transcriptChunks()) {
        this.send({ id: contentId, type: 'text_delta', delta: chunk });
      }
      this.send({ type: 'control', action: 'text_done', id: contentId });
    };

    try {
      await Promise.all([handleAudioChunks(), handleAudioTranscript()]);
      this.logger.debug('Audio content processed successfully');
    } catch (error) {
      this.logger.error({ error }, 'Error handling audio content');
      throw error;
    }
  }

  private async handleResponse(event: RTResponse) {
    try {
      for await (const item of event) {
        if (isFunctionCallItem(item)) {
          this.logger.debug('Function call item received');
          continue;
        }
        if (item.type === 'message') {
          for await (const content of item) {
            if (content.type === 'text') {
              await this.handleTextContent(content);
            } 
            else if (content.type === 'audio') {
              await this.handleAudioContent(content);
            }
          }
        }
      }
      this.logger.debug('Response handled successfully'); 
    } catch (error) {
      this.logger.error({ error }, 'Error handling response');
      throw error;
    }
  }

  private async handleInputAudio(event: RTInputAudioItem) {
    try {
      this.send({ type: 'control', action: 'speech_started' });
      await event.waitForCompletion();

      const transcription: Transcription = {
        // id: event.id,
        type: 'transcription',
        text: event.transcription || '',
      };
      this.send(transcription);
      this.logger.debug(
        { transcriptionLength: transcription.text.length },
        'Input audio processed successfully',
      );
    } catch (error) {
      this.logger.error({ error }, 'Error handling input audio');
      throw error;
    }
  }

  private async startEventLoop() {
    try {
      this.logger.debug('Starting event loop');
      for await (const event of this.rtClient.events()) {
        this.logger.debug({ event }, 'Event loop iteration');
        if (event.type === 'response') {
          this.logger.debug('Event loop handling response');
          await this.handleResponse(event);
        } 
        else if (event.type === 'input_audio') {
          this.logger.debug('Event loop handling input_audio');
          await this.handleInputAudio(event);
        }
      }
    } catch (error) {
      this.logger.error({ error }, 'Error in event loop');
      throw error;
    }
  }

  private async handleFunctionCall(message: any) {

    const params = JSON.parse(message.arguments)
    const funcName = message.name

    this.logger.debug({ funcName, params }, 'Function call received');

  }

}
