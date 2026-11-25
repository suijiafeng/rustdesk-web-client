import { FragmentReader, FRAGMENT_PAYLOAD, MAX_MESSAGE_BYTES } from '../../../shared/webrtc';

export class DataChannelStream {
  readonly reader = new FragmentReader();
  private queue: Uint8Array[] = [];
  private queueBytes = 0;
  private waiter: { resolve: (value: Uint8Array | null) => void; reject: (error: Error) => void } | null = null;
  private closed = false;
  private error: Error | null = null;
  private sending = Promise.resolve();
  private pendingBytes = 0;

  constructor(private channel: RTCDataChannel) {
    channel.binaryType = 'arraybuffer';
    channel.onmessage = event => {
      if (this.closed) return;
      try {
        if (!(event.data instanceof ArrayBuffer)) throw new Error('Unexpected WebRTC data');
        const message = this.reader.push(new Uint8Array(event.data));
        if (!message) return;
        if (this.waiter) {
          const waiter = this.waiter;
          this.waiter = null;
          waiter.resolve(message);
        } else {
          this.queueBytes += message.length;
          if (this.queueBytes > MAX_MESSAGE_BYTES || this.queue.length >= 256) throw new Error('WebRTC receive queue is full');
          this.queue.push(message);
        }
      } catch (error) { this.fail(error); }
    };
    channel.onclose = () => this.close();
    channel.onerror = () => this.fail(new Error('WebRTC data channel failed'));
  }

  fail(error: unknown): void {
    this.error = error instanceof Error ? error : new Error(String(error));
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.queue = [];
    this.queueBytes = 0;
    const waiter = this.waiter;
    this.waiter = null;
    if (this.error) waiter?.reject(this.error);
    else waiter?.resolve(null);
    this.channel.close();
  }

  next(timeout = 0): Promise<Uint8Array | null> {
    if (this.error) return Promise.reject(this.error);
    if (this.queue.length) {
      const message = this.queue.shift()!;
      this.queueBytes -= message.length;
      return Promise.resolve(message);
    }
    if (this.closed) return Promise.resolve(null);
    if (this.waiter) return Promise.reject(new Error('Concurrent WebRTC readers'));
    return new Promise((resolve, reject) => {
      const timer = timeout ? setTimeout(() => {
        this.waiter = null;
        reject(new Error('WebRTC peer response timed out'));
      }, timeout) : undefined;
      this.waiter = {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      };
    });
  }

  sendRaw(payload: Uint8Array): Promise<void> {
    if (this.closed || this.pendingBytes + payload.length > 4 * 1024 * 1024) {
      return Promise.reject(new Error('WebRTC send queue is unavailable'));
    }
    this.pendingBytes += payload.length;
    const result = this.sending.then(async () => {
      for (let offset = 0; offset < Math.max(1, payload.length); offset += FRAGMENT_PAYLOAD) {
        const deadline = Date.now() + 5000;
        while (this.channel.bufferedAmount > 1024 * 1024 && !this.closed) {
          if (Date.now() >= deadline) throw new Error('WebRTC send timed out');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        if (this.closed || this.channel.readyState !== 'open') throw new Error('WebRTC channel is closed');
        const part = payload.subarray(offset, offset + FRAGMENT_PAYLOAD);
        const fragment = new Uint8Array(part.length + 1);
        fragment[0] = offset + part.length < payload.length ? 1 : 0;
        fragment.set(part, 1);
        this.channel.send(fragment);
      }
    }).finally(() => { this.pendingBytes -= payload.length; });
    this.sending = result.catch(error => this.fail(error));
    return result;
  }
}
