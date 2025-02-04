import { Component, ElementRef, Input, ViewChild } from '@angular/core';
import { Message } from '@shared/interfaces';

@Component({
  selector: 'app-chat-messages',
  templateUrl: './chat-messages.component.html',
  styleUrls: ['./chat-messages.component.css']
})
export class ChatMessagesComponent {
  showMessages: boolean = true;
  isConnected = true;

  private _messages: Message[] = [];
  
  @Input()
  get messages(): Message[] {
    return this._messages;
  }
  set messages(value: Message[]) {
    this._messages = value;
    this.scrollToBottom();
  }

  @ViewChild('messagesEnd') messagesEnd!: ElementRef;

  private scrollToBottom(): void {
    if (this.messagesEnd) {
      this.messagesEnd.nativeElement.scrollIntoView({ behavior: 'smooth' });
    }
  }
}