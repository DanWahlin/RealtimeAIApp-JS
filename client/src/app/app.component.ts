import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ChatInterfaceComponent } from "./chat-interface/chat-interface.component";

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, ChatInterfaceComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = 'Realtime AI';
}
