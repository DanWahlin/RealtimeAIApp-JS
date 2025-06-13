
export type WSMessage =
    | { id: string; type: 'text_delta'; delta: string }
    | { id?: string; type: 'transcription'; text: string }
    | { id: string; type: 'user_message'; text: string }
    | { type: 'control'; action: 'speech_started' | 'connected' | 'text_done' | 'function_call_output'; functionCallParams?: string; id?: string }
    | { type: 'control'; action: 'session_created'; id?: string }; // Added for session created notification

export type FunctionCallResponse = {
    type: 'function_call_output';
    call_id: string;
    output: string;
}

export type SystemMessageTool = {
    type?: string,
    name?: string,
    description?: string,
    parameters?: any
}

export type SystemMessage = {
    type: 'language-coach' | 'medical-form' | 'medical-question-answer';
    initialInstructions: string;
    message: string;
    tools?: SystemMessageTool[];
}

export type AudioMetrics = {
    totalBytesSent: number;
    totalBatchesSent: number;
    maxBatchSize: number;
    lastSendTime: number;
    droppedChunks: number;
}
  