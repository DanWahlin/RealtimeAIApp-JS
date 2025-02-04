import { Component } from '@angular/core';
import { Message } from '@shared/interfaces';
import { ChatMessagesComponent } from 'app/chat-messages/chat-messages.component';
import { ChatToolbarComponent } from 'app/chat-toolbar/chat-toolbar.component';

@Component({
  selector: 'app-language-coach',
  imports: [ChatToolbarComponent, ChatMessagesComponent],
  templateUrl: './language-coach.component.html',
  styleUrl: './language-coach.component.css'
})
export class LanguageCoachComponent {
  messages: Message[] = [];

  onMessagesChanged(messages: Message[]) {
    this.messages = messages;
  }
}
