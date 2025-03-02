export type InitMessage = { 
    role: string; 
    message: string; 
    tools: any[]; 
};

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