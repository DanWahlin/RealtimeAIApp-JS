import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

interface WebSocketMessage {
  type: 'binary' | 'text';
  data: ArrayBuffer | string;
}

@Injectable({
  providedIn: 'root',
})
export class WebSocketService implements AsyncIterable<WebSocketMessage> {
  private socket: WebSocket | null = null;
  private messageSubject = new Subject<WebSocketMessage>();
  private connectedSubject = new BehaviorSubject<boolean>(false);
  private errorSubject = new Subject<Error>();
  private messageQueue: WebSocketMessage[] = [];
  private hasError = false;

  connect(url: string): void {
    if (this.socket) this.close();

    this.socket = new WebSocket(url);
    this.socket.binaryType = 'arraybuffer';

    this.socket.onopen = () => this.connectedSubject.next(true);
    this.socket.onclose = () => this.connectedSubject.next(false);
    this.socket.onerror = (event: Event) => {
      const error = (event as ErrorEvent).error || new Error('WebSocket error');
      this.handleError(error);
    };

    this.socket.onmessage = (event: MessageEvent) => {
      const message: WebSocketMessage = {
        type: event.data instanceof ArrayBuffer ? 'binary' : 'text',
        data: event.data
      };
      this.messageQueue.push(message);
      this.messageSubject.next(message);
    };
  }

  private handleError(error: Error) {
    this.hasError = true;
    this.errorSubject.next(error);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<WebSocketMessage> {
    while (true) {
      if (this.hasError) {
        throw this.errorSubject;
      }
      if (this.messageQueue.length > 0) {
        yield this.messageQueue.shift()!;
      } else {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  send(message: WebSocketMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(message.data);
    }
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
  }

  get messages$() { return this.messageSubject.asObservable(); }
  get isConnected$() { return this.connectedSubject.asObservable(); }
  get errors$() { return this.errorSubject.asObservable(); }
}