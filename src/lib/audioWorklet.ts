import { PcmJitterBuffer } from './audioBuffer';

declare const sampleRate: number;
declare const currentTime: number;
declare abstract class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
}
declare function registerProcessor(name: string, processor: typeof AudioWorkletProcessor): void;

class RemotePcmProcessor extends AudioWorkletProcessor {
  private readonly buffer = new PcmJitterBuffer(sampleRate);
  private generation = 0;
  private stopped = false;

  constructor() {
    super();
    this.port.onmessage = event => {
      const message = event.data;
      try {
        if (message.type === 'reset') {
          this.generation = message.generation;
          this.buffer.reset();
        } else if (message.type === 'pcm') {
          if (message.generation === this.generation) {
            for (const block of message.blocks) {
              if (currentTime - block.receivedAt <= 0.2) this.buffer.push(block.planes, block.sampleRate, block.receivedAt);
            }
          }
          this.port.postMessage({ type: 'consumed', generation: message.generation, id: message.id });
        } else if (message.type === 'close') {
          this.buffer.reset();
          this.stopped = true;
        }
      } catch {
        this.buffer.reset();
        this.stopped = true;
        this.port.postMessage({ type: 'error' });
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    if (outputs[0]) this.buffer.render(outputs[0], currentTime);
    return !this.stopped;
  }
}

registerProcessor('rustdesk-pcm', RemotePcmProcessor);
