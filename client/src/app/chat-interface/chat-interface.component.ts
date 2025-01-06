import { NgClass } from '@angular/common';
import { Component, OnInit, OnDestroy, ElementRef, ViewChild, inject } from '@angular/core';
import { PlayerService } from '@core/player.service';
import { RecorderService } from '@core/recorder.service';
import { WebSocketService } from '@core/web-socket.service';
import { Subscription, firstValueFrom } from 'rxjs';

interface Message {
  id: string;
  type: string;
  content: string;
}

interface WSMessage {
  type: string;
  id?: string;
  text?: string;
  delta?: string;
  action?: string;
  greeting?: string;
}

@Component({
  selector: 'app-chat-interface',
  templateUrl: './chat-interface.component.html',
  styleUrls: ['./chat-interface.component.css'],
  imports: [NgClass]
})
export class ChatInterfaceComponent implements OnInit, OnDestroy {
  endpoint = 'ws://localhost:8080/realtime';
  messages: Message[] = [];
  currentMessage = '';
  isRecording = false;
  isConnected = false;
  isConnecting = false;
  validEndpoint = true;
  messageMap = new Map<string, Message>();
  currentConnectingMessage: Message | undefined = { id: '', type: '', content: '' };
  currentUserMessage: Message | undefined = { id: '', type: '', content: '' };
  private subscriptions = new Subscription();

  playerService = inject(PlayerService);
  recorderService = inject(RecorderService);
  webSocketService = inject(WebSocketService);

  @ViewChild('messagesEnd', { static: true }) messagesEndRef!: ElementRef;

  ngOnInit(): void {
    // Subscribe to connection status
    this.subscriptions.add(
      this.webSocketService.isConnected$.subscribe((connected) => {
        this.isConnected = connected;
        if (!connected) {
          this.messages = []; // Clear messages on disconnection
        }
      })
    );

    // Subscribe to WebSocket messages
    this.subscriptions.add(
      this.webSocketService.messages$.subscribe(async (message) => {
        if (message.type === 'text') {
          const data = JSON.parse(message.data) as WSMessage;
          await this.handleWSMessage(data);
        } 
        else if (message.type === 'binary' && this.playerService.initialized) {
          this.playerService.play(new Int16Array(message.data));
        }
      })
    );
    this.scrollToBottom();
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
    this.disconnect();
  }

  async initAudioPlayer() {
    await this.playerService.init(24000);
  }

  async handleAudioRecord(isRecording: boolean) {
    const isConnected = await firstValueFrom(this.webSocketService.isConnected$);
    if (!isRecording && isConnected) {
      this.recorderService.setOnDataAvailableCallback(async (buffer) => {
        await this.webSocketService.send({ type: 'binary', data: buffer });
      });
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          sampleRate: 24000,
        },
      });
      await this.recorderService.start(stream);
      return true;
    } else {
      this.recorderService.stop();
      return false;
    }
  }

  scrollToBottom() {
    this.messagesEndRef.nativeElement.scrollIntoView({ behavior: 'smooth' });
  }

  async handleWSMessage(message: WSMessage) {
    switch (message.type) {
      case 'transcription':
        if (message.id) {
          this.currentUserMessage!.content = message.text!;
          this.messages = Array.from(this.messageMap.values());
        }
        break;
      case 'text_delta':
        if (message.id) {
          const existingMessage = this.messageMap.get(message.id);
          if (existingMessage) {
            existingMessage.content += message.delta!;
          } 
          else {
            const newMessage: Message = {
              id: message.id,
              type: 'assistant',
              content: message.delta!,
            };
            this.messageMap.set(message.id, newMessage);
          }
          this.messages = Array.from(this.messageMap.values());
        }
        break;
      case 'control':
        if (message.action === 'connected' && message.greeting) {
          this.currentConnectingMessage!.content = message.greeting!;
          this.messages = Array.from(this.messageMap.values());
        } 
        else if (message.action === 'speech_started') {
          this.playerService.clear();
          const contrivedId = 'userMessage' + Math.random();
          this.currentUserMessage = {
            id: contrivedId,
            type: 'user',
            content: '...',
          };
          this.messageMap.set(contrivedId, this.currentUserMessage);
          this.messages = Array.from(this.messageMap.values());
        }
        break;
    }
  }

  async handleConnect() {
    if (this.isConnected) {
      await this.disconnect();
    } 
    else {
      this.isConnecting = true;
      try {
        this.webSocketService.connect(this.endpoint);
      } 
      catch (error) {
        console.error('Connection failed:', error);
      } 
      finally {
        this.isConnecting = false;
      }
    }
  }

  async disconnect() {
    this.isConnected = false;
    if (this.isRecording) {
      await this.toggleRecording();
    }
    this.recorderService.stop();
    await this.playerService.clear();
    this.webSocketService.close();
    this.messageMap.clear();
    this.messages = [];
  }

  async sendMessage() {
    if (this.currentMessage.trim() && this.isConnected) {
      const messageId = `user-${Date.now()}`;
      const newMessage: Message = {
        id: messageId,
        type: 'user',
        content: this.currentMessage,
      };
      this.messages.push(newMessage);
      this.currentMessage = '';

      await this.webSocketService.send({
        type: 'text',
        data: JSON.stringify({
          type: 'user_message',
          text: newMessage.content,
        }),
      });
    }
  }

  async toggleRecording() {
    try {
      const newRecordingState = await this.handleAudioRecord(this.isRecording);
      this.isRecording = newRecordingState;
    } 
    catch (error) {
      console.error('Recording error:', error);
      this.isRecording = false;
    }
  }

  onInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.currentMessage = input.value || '';
  }

}

// import { Component, OnInit, OnDestroy, inject } from '@angular/core';
// import { AudioPlayerService } from '../core/audio-player.service';
// import { AudioRecorderService } from '../core/audio-recorder.service';
// import { WebSocketClientService, WebSocketMessage } from '../core/websocket-client.service';
// import { NgClass } from '@angular/common';
// import { Subscription } from 'rxjs';

// interface Message {
//   id: string;
//   type: 'user' | 'assistant' | 'status';
//   content: string;
// }

// type WSControlAction = "speech_started" | "connected" | "text_done";

// @Component({
//   selector: 'app-chat-interface',
//   templateUrl: './chat-interface.component.html',
//   styleUrls: ['./chat-interface.component.css'],
//   imports: [NgClass],
// })
// export class ChatInterfaceComponent implements OnInit, OnDestroy {
//   endpoint = 'ws://localhost:8080/realtime';
//   messages: Message[] = [];
//   currentMessage = '';
//   isRecording = false;
//   isConnected = false;
//   isConnecting = false;
//   validEndpoint = true;

//   private subscriptions = new Subscription();

//   audioPlayerService = inject(AudioPlayerService);
//   audioRecorderService = inject(AudioRecorderService);
//   webSocketClientService = inject(WebSocketClientService);

//   ngOnInit(): void {
//     // Subscribe to connection status
//     this.subscriptions.add(
//       this.webSocketClientService.isConnected$.subscribe((connected) => {
//         this.isConnected = connected;
//         if (!connected) {
//           this.messages = []; // Clear messages on disconnection
//         }
//       })
//     );

//     // Subscribe to WebSocket messages
//     this.subscriptions.add(
//       this.webSocketClientService.messages$.subscribe((message) => {
//         this.handleWSMessage(message);
//       })
//     );
//   }

//   ngOnDestroy(): void {
//     this.subscriptions.unsubscribe();
//     this.disconnect();
//   }

//   validateEndpoint(url: string): void {
//     this.endpoint = url;
//     try {
//       new URL(url);
//       this.validEndpoint = true;
//     } catch {
//       this.validEndpoint = false;
//     }
//   }

//   async handleConnect(): Promise<void> {
//     if (this.isConnected) {
//       await this.disconnect();
//     } else {
//       this.isConnecting = true;
//       try {
//         this.webSocketClientService.connect(this.endpoint);
//       } catch (error) {
//         console.error('Connection failed:', error);
//       } finally {
//         this.isConnecting = false;
//       }
//     }
//   }

//   async disconnect(): Promise<void> {
//     if (this.isRecording) {
//       await this.toggleRecording();
//     }
//     await this.audioRecorderService.stop();
//     this.audioPlayerService.clear();
//     this.webSocketClientService.close();
//   }

//   async toggleRecording(): Promise<void> {
//     try {
//       if (!this.isRecording && this.isConnected) {
//         this.isRecording = true;
//         await this.audioRecorderService.start((buffer: ArrayBuffer) => {
//           this.webSocketClientService.send({ type: 'binary', data: buffer }).catch((error) => {
//             console.error('WebSocket send error:', error);
//           });
//         });
//       } else {
//         this.isRecording = false;
//         await this.audioRecorderService.stop();
//       }
//     } catch (error) {
//       console.error('Recording error:', error);
//       this.isRecording = false;
//     }
//   }
  

//   private handleWSMessage(message: WebSocketMessage): void {
//     if (message.type === 'text') {
//       const parsedMessage = JSON.parse(message.data);
//       this.processParsedMessage(parsedMessage);
//     } else if (message.type === 'binary') {
//       this.audioPlayerService.play(new Int16Array(message.data));
//     }
//   }

//   private processParsedMessage(parsedMessage: any): void {
//     switch (parsedMessage.type) {
//       case 'text_delta':
//         // Process text_delta messages
//         break;
//       case 'control':
//         // Handle control messages
//         break;
//       default:
//         console.warn('Unknown message type:', parsedMessage);
//     }
//   }

//   onInputChange(event: Event): void {
//     const input = event.target as HTMLInputElement;
//     this.currentMessage = input.value || '';
//   }
  
// }
