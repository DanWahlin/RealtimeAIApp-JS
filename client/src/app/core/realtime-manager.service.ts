import { Injectable, OnDestroy, inject } from '@angular/core';
import { WebSocketService } from '@core/web-socket.service';
import { PlayerService } from '@core/player.service';
import { RecorderService } from '@core/recorder.service';
import { Message, WSMessage } from '@shared/interfaces';
import { Subscription, firstValueFrom, BehaviorSubject, filter } from 'rxjs';

@Injectable({
  providedIn: 'root'
})
export class RealTimeManagerService implements OnDestroy {
  private endpoint = 'ws://localhost:8080/realtime';
  private subscriptions = new Subscription();
  private messageMap = new Map<string, Message>();
  private currentUserMessage: Message | undefined = { id: '', type: '', content: '' };

  private _isConnected = new BehaviorSubject<boolean>(false);
  isConnected$ = this._isConnected.asObservable();

  private _isConnecting = new BehaviorSubject<boolean>(false);
  isConnecting$ = this._isConnecting.asObservable();

  private _isSessionCreated = new BehaviorSubject<boolean>(false);
  sessionCreated$ = this._isSessionCreated.asObservable();

  private _isAudioOn = new BehaviorSubject<boolean>(true);
  isAudioOn$ = this._isAudioOn.asObservable();

  private _messages = new BehaviorSubject<Message[]>([]);
  messages$ = this._messages.asObservable();

  private _isRecording = new BehaviorSubject<boolean>(false);
  isRecording$ = this._isRecording.asObservable();

  playerService = inject(PlayerService);
  recorderService = inject(RecorderService);
  webSocketService = inject(WebSocketService);

  async init() {
    this.playerService.init(24000);

    this.subscriptions.add(
      this.webSocketService.isConnected$.subscribe(this.handleConnectionChange)
    );

    this.subscriptions.add(
      this.sessionCreated$.subscribe((isSessionCreated) => {
          if (isSessionCreated) {
            console.log('Session created');
            this._isConnecting.next(false);
            this._isConnected.next(true);
            this.toggleRecording();
          }
      })
    );

    this.subscriptions.add(
      this.webSocketService.messages$.subscribe(this.handleWebSocketMessage)
    );
  }

  async connect(instructions: string) {
    if (this._isConnected.value) {
      await this.disconnect();
      return;
    } 
    
    // Start connection process
    this._isConnecting.next(true);
    try {
      // Connect will trigger WebSocketService.onopen which will emit isConnected$
      await this.webSocketService.connect(this.endpoint, instructions);
    } catch (error) {
      this.logError('Connection failed:', error);
      this._isConnecting.next(false);
      this._isConnected.next(false);
    }
  }

  private handleConnectionChange = (connected: boolean) => {
    console.log('Connected:', connected);
    if (!connected) {
      this._messages.next([]);
      this.messageMap.clear(); 
    }
  };

  private handleWebSocketMessage = async (message: any) => {
    try {
      if (message.type === 'text') {
        const data = JSON.parse(message.data as string) as WSMessage;
        await this.handleWSMessage(data);
      } 
      else if (message.type === 'binary' && this.playerService.initialized && this._isAudioOn.value) {
        this.playerService.play(new Int16Array(message.data as ArrayBuffer));
      }
    } 
    catch (error) {
      this.logError('Error handling WebSocket message:', error);
    }
  };

  private logError(message: string, error: any) {
    console.error(message, error);
  }

  async toggleRecording() {
    try {
      console.log('this._isRecording.value:', this._isRecording.value);
      const newRecordingState = await this.handleAudioRecord(this._isRecording.value);
      console.log('Recording:', newRecordingState);
      this._isRecording.next(newRecordingState);
      return newRecordingState;
    } catch (error) {
      this.logError('Recording error:', error);
      this._isRecording.next(false);
      return false;
    }
  }

  toggleAudio() {
    const newState = !this._isAudioOn.value;
    this._isAudioOn.next(newState);
    return newState;
  }

  async handleAudioRecord(isRecording: boolean) {
    const isConnected = this._isConnected.value;
    if (!isRecording && isConnected) {
      try {
        this.recorderService.setOnDataAvailableCallback(async (buffer) => {
          await this.webSocketService.send({ type: 'binary', data: buffer });
        });
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, sampleRate: 24000 },
        });
        await this.recorderService.start(stream);
        return true;
      } catch (error) {
        console.error('Failed to start recording:', error);
        await this.recorderService.reset(); // Reset on failure
        return false;
      }
    } else {
      await this.recorderService.stop();
      return false;
    }
  }

  private async handleWSMessage(message: WSMessage) {
    switch (message.type) {
      case 'transcription':
        if (message.id) {
          this.currentUserMessage!.content = message.text!;
          this._messages.next(Array.from(this.messageMap.values()));
        }
        break;
      case 'text_delta':
        if (message.id) {
          const existingMessage = this.messageMap.get(message.id);
          if (existingMessage) {
            existingMessage.content += message.delta!;
          } else {
            const newMessage: Message = {
              id: message.id,
              type: 'assistant',
              content: message.delta!,
            };
            this.messageMap.set(message.id, newMessage);
          }
          this._messages.next(Array.from(this.messageMap.values()));
        }
        break;
      case 'control':
        let userMessage: Message | null = null;
        switch (message.action) {
          case 'function_call_output':
            if (!message.id || !message.functionCallParams) break;
            // Clear both _messages and messageMap before processing new function call output
            this._messages.next([]);
            this.messageMap.clear();
            userMessage = {
              id: message.id,
              type: message.type,
              action: message.action,
              content: message.functionCallParams,
            };
            console.log('function_call_output:', userMessage);
            if (userMessage) {
              this.messageMap.set(userMessage.id, userMessage);
              this._messages.next([userMessage]); // Emit only the new function_call_output message
            }
            break;
          case 'speech_started':
            this.playerService.clear();
            const contrivedId = 'userMessage' + Math.random();
            userMessage = {
              id: contrivedId,
              type: 'user',
              content: '...',
            };
            if (userMessage) {
              this.messageMap.set(userMessage.id, userMessage);
              this._messages.next(Array.from(this.messageMap.values()));
            }
            break;
          case 'session_created':
            this._isSessionCreated.next(true); // Update session status
            console.log('Session created notification received:', message.id);
            break;
        }
        break;
    }
  }

  async connectWebSocket(endpoint: string, instructions: string) {
    try {
      this.webSocketService.connect(endpoint, instructions);
    } catch (error) {
      this.logError('Connection failed:', error);
    }
  }

  async sendMessage(content: string) {
    if (content && await firstValueFrom(this.isConnected$)) {
      const messageId = `user-${Date.now()}`;
      const newMessage: Message = {
        id: messageId,
        type: 'user',
        content: content,
      };
      this._messages.next([...this._messages.value, newMessage]);
      await this.webSocketService.send({
        type: 'text',
        data: JSON.stringify({
          type: 'user_message',
          text: newMessage.content,
        }),
      });
    }
  }

  async disconnect() {
    console.log('Disconnecting...');
    await this.recorderService.reset();
    await this.playerService.clear();
    this.webSocketService.close();
    this.messageMap.clear();
    this._isConnecting.next(false);
    this._isConnected.next(false);
    this._isSessionCreated.next(false);
    this._messages.next([]);
    this._isAudioOn.next(true);
    this._isRecording.next(false);
  }

  ngOnDestroy() {
    this.subscriptions.unsubscribe();
    this.disconnect();
  }
}