import { Component, OnInit, OnDestroy, inject, EventEmitter, Output, Input } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';

import { RealTimeManagerService } from '@core/realtime-manager.service';
import { Message } from '@shared/interfaces';
import { AsyncPipe } from '@angular/common';

@Component({
  selector: 'app-chat-toolbar',
  templateUrl: './chat-toolbar.component.html',
  styleUrls: ['./chat-toolbar.component.css'],
  imports: [ AsyncPipe, MatIconModule, MatButtonModule ]
})
export class ChatToolbarComponent implements OnInit, OnDestroy {
  currentMessage = '';
  @Input() showMessageInput = true;
  @Input() instructions = '';

  @Output() messagesChanged = new EventEmitter<Message[]>();

  realtimeManagerService = inject(RealTimeManagerService);

  async ngOnInit() {
    await this.realtimeManagerService.init();

    this.realtimeManagerService.messages$.subscribe((messages) => {
      this.messagesChanged.emit(messages);
    });
  }

  async connect() {
    await this.realtimeManagerService.connect(this.instructions);
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
    this.realtimeManagerService.ngOnDestroy();
  }
}