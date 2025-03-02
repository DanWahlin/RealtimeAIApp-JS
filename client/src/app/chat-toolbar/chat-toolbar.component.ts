import { Component, OnInit, OnDestroy, inject, EventEmitter, Output, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { RealTimeManagerService } from '@core/realtime-manager.service';
import { InitMessage, Message } from '@shared/types';
import { AsyncPipe } from '@angular/common';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-chat-toolbar',
  templateUrl: './chat-toolbar.component.html',
  styleUrls: ['./chat-toolbar.component.css'],
  imports: [AsyncPipe, MatIconModule, MatButtonModule]
})
export class ChatToolbarComponent implements OnInit, OnDestroy {
  currentMessage = '';
  @Input() showMessageInput = true;
  @Input() initMessage = {} as InitMessage;
  @Output() messagesChanged = new EventEmitter<Message[]>();
  realtimeManagerService = inject(RealTimeManagerService);
  subscription = new Subscription();

  async ngOnInit() {
    await this.setupRealTimeManager();
  }

  private async setupRealTimeManager() {
    await this.realtimeManagerService.init();
  
    // Clear any existing subscription to messages$ to prevent duplicates
    this.subscription.unsubscribe();
    this.subscription = new Subscription();
  
    this.subscription.add(
      this.realtimeManagerService.messages$.subscribe((messages) => {
        this.messagesChanged.emit(messages);
      })
    );
  }

  async connect() {
    if (this.realtimeManagerService.isConnected) {
      await this.realtimeManagerService.disconnect();
    } 
    else {
      const connectionSubscription = this.realtimeManagerService.isConnected$.subscribe({
        next: (isConnected) => {
          if (isConnected) {
            console.log('Client session established. Setting up real-time manager.');
            this.setupRealTimeManager();
            connectionSubscription.unsubscribe();
          }
        }
      });
      
      this.subscription.add(connectionSubscription);      
      await this.realtimeManagerService.connect(this.initMessage);
    }
  }

  async sendMessage() {
    await this.realtimeManagerService.sendMessage(this.currentMessage);
    this.currentMessage = '';
  }

  async toggleRecording() {
    await this.realtimeManagerService.toggleRecording();
  }

  toggleAudio() {
    this.realtimeManagerService.toggleAudio();
  }

  onInputChange(event: Event) {
    const input = event.target as HTMLInputElement;
    this.currentMessage = input.value || '';
  }

  ngOnDestroy() {
    this.subscription.unsubscribe();
    this.realtimeManagerService.disconnect();
  }
}