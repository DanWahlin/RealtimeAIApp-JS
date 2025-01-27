import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';

interface BinaryWebSocketMessage {
  type: 'binary';
  data: ArrayBuffer;
}

interface TextWebSocketMessage {
  type: 'text';
  data: string;
}

export type WebSocketMessage = BinaryWebSocketMessage | TextWebSocketMessage;

type ResolveFn<T> = (value: IteratorResult<T>) => void;
type RejectFn<E> = (reason: E) => void;

@Injectable({
  providedIn: 'root',
})
export class WebSocketService implements AsyncIterable<WebSocketMessage> {
  private socket: WebSocket | null = null;
  private messageSubject = new Subject<WebSocketMessage>();
  private connectedSubject = new BehaviorSubject<boolean>(false);
  private errorSubject = new Subject<Error>();
  private done = false;
  private messageQueue: WebSocketMessage[] = [];
  private receiverQueue: [ResolveFn<WebSocketMessage>, RejectFn<Error>][] = [];
  private hasError = false;

  connect(url: string): void {
    if (this.socket) {
      this.close();
    }

    this.socket = new WebSocket(url);
    this.socket.binaryType = 'arraybuffer';

    this.socket.onopen = () => {
      this.connectedSubject.next(true);
    };

    this.socket.onmessage = (event: MessageEvent) => {
      const data = event.data;
      const message: WebSocketMessage =
        data instanceof ArrayBuffer
          ? { type: 'binary', data }
          : { type: 'text', data };
      this.messageHandler(message);
    };

    this.socket.onerror = (event: Event) => {
      const error = (event as ErrorEvent).error || new Error('WebSocket error');
      this.handleError(error);
      this.connectedSubject.next(false);
    };

    this.socket.onclose = () => {
      this.done = true;
      this.connectedSubject.next(false);
      this.handleClose();
    };
  }

  private handleError(error: Error) {
    this.hasError = true;
    this.errorSubject.next(error);
    while (this.receiverQueue.length > 0) {
      const [_, reject] = this.receiverQueue.shift()!;
      reject(error);
    }
  }

  private handleClose() {
    while (this.receiverQueue.length > 0) {
      const [resolve, reject] = this.receiverQueue.shift()!;
      if (this.hasError) {
        const error = new Error('WebSocket closed');
        reject(error);
      } else {
        resolve({ value: undefined, done: true });
      }
    }
  }

  private messageHandler(message: WebSocketMessage) {
    if (this.receiverQueue.length > 0) {
      const [resolve, _] = this.receiverQueue.shift()!;
      resolve({ value: message, done: false });
    } else {
      this.messageQueue.push(message);
    }
    this.messageSubject.next(message);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<WebSocketMessage> {
    while (true) {
      if (this.hasError) {
        throw this.errorSubject;
      }
      if (this.done) {
        return;
      }
      if (this.messageQueue.length > 0) {
        yield this.messageQueue.shift()!;
        continue;
      }
      const message = await new Promise<IteratorResult<WebSocketMessage>>((resolve, reject) => {
        this.receiverQueue.push([resolve, reject]);
      });
      yield message.value;
    }
  }

  send(message: WebSocketMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(message.data);
    } else {
      throw new Error('WebSocket is not open');
    }
  }

  close(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  get messages$() {
    return this.messageSubject.asObservable();
  }

  get isConnected$() {
    return this.connectedSubject.asObservable();
  }

  get errors$() {
    return this.errorSubject.asObservable();
  }
}