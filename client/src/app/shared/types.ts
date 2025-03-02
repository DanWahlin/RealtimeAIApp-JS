export type Message = {
  id: string;
  type: string;
  action?: string;
  content: string;
}

export type WSMessage = {
  type: string;
  id?: string;
  text?: string;
  delta?: string;
  action?: string;
  functionCallParams?: string;
}

export type WebSocketMessage = {
  type: 'binary' | 'text' | 'init';
  data: ArrayBuffer | string;
}

export type ConnectionState = 'disconnected' | 'connecting' | 'connected';

export type InitMessage = { 
  type: 'init';
  role: string; 
  message: string; 
  tools: any[]; 
};

export enum PatientTab {
  Patient = 'patient',
  Symptoms = 'symptoms',
  Vitals = 'vitals'
}

export type Symptom = {
  id: number;
  description: string;
  duration: string;
  severity: number;
  notes: string;
}

export type Patient = {
  tab: PatientTab;
  information: { name: string; dob: string; gender: string, notes: string };
  symptoms: Symptom[];
  vitals: { temperature: number; bloodPressure: string; heartRate: number };
}