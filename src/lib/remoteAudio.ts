import { AUDIO_MAX_LATENCY_MS } from './audioBuffer';

export type AudioFailureStage = 'start' | 'module' | 'decode' | 'playback';

interface PcmBlock {
  planes: Float32Array[];
  sampleRate: number;
  receivedAt: number;
  duration: number;
}

// RustDesk sends raw Opus packets; keep playback alive across packet boundaries.
export class RemoteAudio {
  private context = new AudioContext({ latencyHint: 'interactive' });
  private decoder: AudioDecoder | null = null;
  private node: AudioWorkletNode | null = null;
  private loading: Promise<void> | null = null;
  private resuming: Promise<void> | null = null;
  private generation = 0;
  private closed = false;
  private failed = false;
  private lastTimestamp = -1;
  private sequence = 0;
  private inFlight = 0;
  private pending: PcmBlock[] = [];
  private pendingDuration = 0;
  private format: { sampleRate: number; channels: number } | null = null;

  constructor(private onError: (stage: AudioFailureStage, error: unknown) => void) {}

  private async loadWorklet(): Promise<void> {
    // Vite bundles processor imports and returns a same-origin asset URL.
    const { default: url } = await import('./audioWorklet.ts?worker&url');
    await this.context.audioWorklet.addModule(url);
  }

  private ensureWorklet(): Promise<void> {
    return this.loading ??= (async () => {
      if (!this.context.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('AudioWorklet is unavailable');
      await this.loadWorklet();
      if (this.closed) return;
      const node = new AudioWorkletNode(this.context, 'rustdesk-pcm', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [2],
      });
      this.node = node;
      node.onprocessorerror = () => this.fail('playback', new Error('Audio processor failed'));
      node.port.onmessage = event => {
        if (this.closed || this.node !== node) return;
        const message = event.data;
        if (message.type === 'error') { this.fail('playback', new Error('Audio processor rejected PCM')); return; }
        if (message.type === 'consumed' && message.generation === this.generation && message.id === this.inFlight) {
          this.inFlight = 0;
          this.pump();
        }
      };
      node.port.postMessage({ type: 'reset', generation: this.generation });
      node.connect(this.context.destination);
      this.pump();
    })().catch(error => { this.fail('module', error); });
  }

  private get isRunning(): boolean {
    return this.context.state === 'running';
  }

  get suspended(): boolean {
    return !this.closed && !this.isRunning;
  }

  /** Best-effort recovery after tab suspension or audio route interruption without failing the toggle. */
  async tryResume(): Promise<boolean> {
    if (this.closed) return false;
    if (this.isRunning) return true;
    if (this.resuming) {
      await this.resuming;
      return !this.closed && this.isRunning;
    }
    try {
      await this.context.resume();
    } catch {
      return false;
    }
    if (this.closed || !this.isRunning) return false;
    if (this.node && this.format) {
      this.configure(this.format.sampleRate, this.format.channels);
    }
    this.pump();
    return true;
  }

  resume(): Promise<void> {
    if (this.closed) return Promise.resolve();
    if (this.resuming) return this.resuming;
    if (this.node && this.context.state !== 'running' && this.format) {
      this.configure(this.format.sampleRate, this.format.channels);
    }
    return this.resuming ??= (async () => {
      try {
        // Preserve the user gesture: resume before waiting for module loading.
        await Promise.all([this.context.resume(), this.ensureWorklet()]);
        if (!this.closed) this.pump();
      } catch (error) {
        this.fail('start', error);
      } finally {
        this.resuming = null;
      }
    })();
  }

  configure(sampleRate: number, channels: number): void {
    if (this.closed) return;
    const generation = ++this.generation;
    this.pending = [];
    this.pendingDuration = this.inFlight = 0;
    this.lastTimestamp = -1;
    try {
      if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000 ||
          !Number.isInteger(channels) || channels < 1 || channels > 2) throw new Error('Invalid audio format');
      this.format = { sampleRate, channels };
      if (this.decoder?.state !== 'closed') this.decoder?.close();
      this.node?.port.postMessage({ type: 'reset', generation });
      this.decoder = new AudioDecoder({
        output: frame => {
          try {
            if (this.closed || generation !== this.generation || this.context.state !== 'running') return;
            if (frame.numberOfChannels !== channels || !Number.isInteger(frame.numberOfFrames) || frame.numberOfFrames < 1 ||
                !Number.isFinite(frame.sampleRate) || frame.sampleRate < 8000 || frame.sampleRate > 192000 ||
                frame.numberOfFrames > frame.sampleRate * 0.12) throw new Error('Invalid decoded audio');
            const receivedAt = frame.timestamp / 1_000_000;
            if (!Number.isFinite(receivedAt) || this.context.currentTime - receivedAt > AUDIO_MAX_LATENCY_MS / 1000) return;
            const planes = Array.from({ length: channels }, (_, planeIndex) => {
              const plane = new Float32Array(frame.numberOfFrames);
              frame.copyTo(plane, { planeIndex, format: 'f32-planar' });
              return plane;
            });
            const duration = frame.numberOfFrames / frame.sampleRate;
            this.pending.push({ planes, sampleRate: frame.sampleRate, receivedAt, duration });
            this.pendingDuration += duration;
            // Preserve normal bursts; discard oldest blocks only over the budget.
            while (this.pendingDuration > AUDIO_MAX_LATENCY_MS / 1000 + 1e-9 || this.pending.length > 32) {
              this.pendingDuration -= this.pending.shift()!.duration;
            }
            this.pump();
          } catch (error) {
            if (generation === this.generation) this.fail('decode', error);
          } finally {
            frame.close();
          }
        },
        error: error => { if (generation === this.generation) this.fail('decode', error); },
      });
      this.decoder.configure({ codec: 'opus', sampleRate, numberOfChannels: channels });
    } catch (error) {
      this.fail('decode', error);
    }
  }

  private pump(): void {
    if (this.closed || !this.node || this.inFlight || this.context.state !== 'running') return;
    const blocks = this.pending.filter(block => this.context.currentTime - block.receivedAt <= AUDIO_MAX_LATENCY_MS / 1000);
    this.pending = [];
    this.pendingDuration = 0;
    if (!blocks.length) return;
    const id = ++this.sequence;
    this.inFlight = id;
    try {
      const buffers = blocks.flatMap(block => block.planes.map(plane => plane.buffer as ArrayBuffer));
      this.node.port.postMessage({ type: 'pcm', generation: this.generation, id, blocks }, buffers);
    } catch (error) {
      this.fail('playback', error);
    }
  }

  push(packet: string | Uint8Array): void {
    if (this.closed || this.context.state !== 'running' || this.decoder?.state !== 'configured') return;
    try {
      if (typeof packet === 'string' ? packet.length > 11000 : !(packet instanceof Uint8Array) || packet.byteLength > 8192) {
        throw new Error('Invalid Opus packet');
      }
      if (this.decoder.decodeQueueSize > 12 && this.format) {
        this.configure(this.format.sampleRate, this.format.channels);
        if (this.closed || this.decoder?.state !== 'configured') return;
      }
      const data = typeof packet === 'string' ? Uint8Array.from(atob(packet), c => c.charCodeAt(0)) : packet;
      if (!data.length || data.length > 8192) throw new Error('Invalid Opus packet');
      const timestamp = Math.max(this.lastTimestamp + 1, Math.round(this.context.currentTime * 1_000_000));
      this.lastTimestamp = timestamp;
      this.decoder.decode(new EncodedAudioChunk({ type: 'key', timestamp, data }));
    } catch (error) {
      this.fail('decode', error);
    }
  }

  private fail(stage: AudioFailureStage, error: unknown): void {
    if (this.closed || this.failed) return;
    this.failed = true;
    this.close();
    this.onError(stage, error);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.generation++;
    this.pending = [];
    this.pendingDuration = this.inFlight = 0;
    if (this.decoder?.state !== 'closed') {
      try { this.decoder?.close(); } catch { /* Decoder may already be closing. */ }
    }
    this.decoder = null;
    if (this.node) {
      this.node.onprocessorerror = null;
      this.node.port.onmessage = null;
      try { this.node.port.postMessage({ type: 'close' }); } catch { /* Detached port. */ }
      this.node.port.close();
      this.node.disconnect();
      this.node = null;
    }
    void this.context.close().catch(() => {});
  }
}
