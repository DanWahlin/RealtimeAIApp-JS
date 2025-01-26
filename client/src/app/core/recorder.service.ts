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
      this.mediaStream = stream;
      this.audioContext = new AudioContext({ latencyHint: 'interactive', sampleRate: 24000 });
      this.mediaStreamSource = this.audioContext.createMediaStreamSource(this.mediaStream);
      //await this.audioContext.audioWorklet.addModule('/recorder-worklet.js');
      const recorderWorkletBlobUrl = URL.createObjectURL(new Blob([`
        registerProcessor('recorder-worklet', class param extends AudioWorkletProcessor {
            constructor() {
              super();
            }

            process(inputs) {
              const input = inputs[0];
              if (input.length > 0) {
                const float32Buffer = input[0];
                const int16Buffer = this.convertFloat32ToInt16(float32Buffer);
                this.port.postMessage(int16Buffer);
              }
              return true;
            }

            convertFloat32ToInt16(float32Array) {
              const int16Array = new Int16Array(float32Array.length);
              for (let i = 0; i < float32Array.length; i++) {
                let val = Math.floor(float32Array[i] * 0x7fff);
                val = Math.max(-0x8000, Math.min(0x7fff, val));
                int16Array[i] = val;
              }
              return int16Array;
            }
          });
        `],
        { type: 'application/javascript' }));
      await this.audioContext.audioWorklet.addModule(recorderWorkletBlobUrl);
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
      console.error('Error starting recorder:', error);
      this.stop();
    }
  }

  stop() {
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }
    if (this.audioContext && this.audioContext.state !== 'closed') {
      this.audioContext.close();
    }
  }
}