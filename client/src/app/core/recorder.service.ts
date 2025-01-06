import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class RecorderService {
  onDataAvailable!: (buffer: ArrayBuffer) => void;
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private mediaStreamSource: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;

  public constructor() {}

  setOnDataAvailableCallback(callback: (buffer: ArrayBuffer) => void) {
    this.onDataAvailable = callback;
  }

  async start(stream: MediaStream) {
    try {
      this.audioContext = new AudioContext({ latencyHint: 'interactive', sampleRate: 24000 });
      await this.audioContext.audioWorklet.addModule('/assets/record-worklet.js');
      this.mediaStream = stream;
      this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.mediaStream);
      this.workletNode = new AudioWorkletNode(this.audioContext, 'recorder-worklet', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        channelCount: 1,
        processorOptions: {
          sampleRate: this.audioContext.sampleRate,
        },
      });
      this.workletNode.port.onmessage = (event) => {
        this.onDataAvailable(event.data.buffer);
      };
      this.mediaStreamSource.connect(this.workletNode);
      this.workletNode.connect(this.audioContext.destination);
    } catch (error) {
      this.stop();
    }
  }

  stop() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }
    if (this.audioContext) {
      this.audioContext.close();
    }
  }
}