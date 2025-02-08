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
  instructions = `You are a helpful language coach that is capable of
  teaching students different phrases in their chosen language. 

  RULES:
  - After the student tells you their chosen language, you will then read sentences in
  English followed by reading the same sentence in the user's chosen language. 
  - The user will then repeat the sentence to you in their chosen language where you'll analyze 
  how well they did prononciation-wise, and let them know. 
  - You will then provide feedback.
  - If you don't clearly understand what the user is saying, please ask them
  to repeat the statement.

  EXAMPLE SENTENCES:
  - What is your name?
  - How are you?
  - Where are you from?
  - What do you do for a living?
  - What is your favorite food?
  `;

  onMessagesChanged(messages: Message[]) {
    this.messages = messages;
  }
}
