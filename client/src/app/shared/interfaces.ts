export interface Message {
    id: string;
    type: string;
    content: string;
}

export interface WSMessage {
    type: string;
    id?: string;
    text?: string;
    delta?: string;
    action?: string;
    greeting?: string;
}

export interface WebSocketMessage {
  type: 'binary' | 'text' | 'init';
  data: ArrayBuffer | string;
}