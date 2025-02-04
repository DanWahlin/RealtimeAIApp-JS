import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ChatToolbarComponent } from "./chat-toolbar/chat-toolbar.component";
import { ChatMessagesComponent } from "./chat-messages/chat-messages.component";
import { Message } from '@shared/interfaces';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ChatToolbarComponent, ChatMessagesComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'Realtime AI';
  messages: Message[] = [];

  onMessagesChanged(messages: Message[]) {
    this.messages = messages;
  }
}
