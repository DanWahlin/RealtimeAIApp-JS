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
  styleUrls: ['./chat-interface.component.css']
})
export class ChatInterfaceComponent implements OnInit, OnDestroy {
  endpoint = 'ws://localhost:8080/realtime';
  messages: Message[] = [];
  currentMessage = '';
  isRecording = false;
  isAudioOff = false;
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

  async ngOnInit() {
    this.playerService.init(24000);
    // Subscribe to connection status
    this.subscriptions.add(
      this.webSocketService.isConnected$.subscribe((connected) => {
        this.isConnected = connected;
        this.toggleRecording();
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
        else if (message.type === 'binary' && this.playerService.initialized && !this.isAudioOff) {
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

  toggleAudio() {
    this.isAudioOff = !this.isAudioOff;
  }

  onInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.currentMessage = input.value || '';
  }

}
