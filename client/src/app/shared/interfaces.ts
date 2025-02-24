export interface Message {
    id: string;
    type: string;
    action?: string;
    content: string;
}

export interface WSMessage {
    type: string;
    id?: string;
    text?: string;
    delta?: string;
    action?: string;
    functionCallParams?: string;
}

export interface WebSocketMessage {
  type: 'binary' | 'text' | 'init';
  data: ArrayBuffer | string;
}