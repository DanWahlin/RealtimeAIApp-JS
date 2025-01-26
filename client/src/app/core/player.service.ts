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
      await audioContext.audioWorklet.addModule('/playback-worklet.js');

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