import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class PlayerService {
  private playbackNode: AudioWorkletNode | null = null;
  initialized = false;

  async init(sampleRate: number) {
    if (this.playbackNode === null) {
      const audioContext = new AudioContext({ sampleRate });
      // await audioContext.audioWorklet.addModule('/playback-worklet.js');
      const playbackWorkletBlobUrl = URL.createObjectURL(new Blob([`
        registerProcessor('playback-worklet', class PlaybackProcessor extends AudioWorkletProcessor {
              constructor() {
                super();
                this.port.onmessage = this.handleMessage.bind(this);
                this.buffer = [];
              }

              handleMessage(event) {
                if (event.data === null) {
                  this.buffer = [];
                  return;
                }
                this.buffer.push(...event.data);
              }

              process(inputs, outputs, parameters) {
                const output = outputs[0];
                const channel = output[0];

                if (this.buffer.length > channel.length) {
                  const toProcess = this.buffer.splice(0, channel.length);
                  channel.set(toProcess.map((v) => v / 32768));
                } else {
                  channel.set(this.buffer.map((v) => v / 32768));
                  this.buffer = [];
                }

                return true;
              }
          });
        `],
        { type: 'application/javascript' }));
      await audioContext.audioWorklet.addModule(playbackWorkletBlobUrl);
      this.playbackNode = new AudioWorkletNode(audioContext, 'playback-worklet');
      this.playbackNode.connect(audioContext.destination);
      this.initialized = true;
    }
  }

  play(buffer: Int16Array) {
    if (this.playbackNode) {
      this.playbackNode.port.postMessage(buffer);
    }
  }

  clear() {
    if (this.playbackNode) {
      this.playbackNode.port.postMessage(null);
    }
  }
}