// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

/** RustDesk sends one raw Opus packet per audio frame. Playback needs a user gesture before resume(). */
export const MAX_AUDIO_QUEUE = 12;

export function webAudioStatus(): { ok: boolean; reason: string } {
  if (typeof AudioContext === 'undefined' || typeof AudioDecoder === 'undefined') {
    return { ok: false, reason: 'This browser cannot play Opus audio.' };
  }
  return { ok: true, reason: '' };
}

export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0, value));
}

export function shouldEnqueueAudio(queueSize: number): boolean {
  return queueSize <= MAX_AUDIO_QUEUE;
}

export function decodeAudioPacket(packet: string): Uint8Array | null {
  if (!packet) return null;
  try {
    const bytes = Uint8Array.from(atob(packet), (char) => char.charCodeAt(0));
    return bytes.byteLength > 0 ? bytes : null;
  } catch {
    return null;
  }
}

export class RemoteAudio {
  private context: AudioContext;
  private gain: GainNode;
  private decoder: AudioDecoder | null = null;
  private nextStart = 0;
  private volume = 1;

  constructor(private onError: () => void) {
    this.context = new AudioContext();
    this.gain = this.context.createGain();
    this.gain.connect(this.context.destination);
  }

  resume(): Promise<void> {
    return this.context.resume().then(() => undefined);
  }

  setVolume(value: number): number {
    this.volume = clampVolume(value);
    this.gain.gain.value = this.volume;
    return this.volume;
  }

  getVolume(): number {
    return this.volume;
  }

  configure(sampleRate: number, channels: number): void {
    try {
      if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
      this.decoder = new AudioDecoder({
        output: (frame) => {
          try {
            if (this.context.state !== 'running') return;
            const now = this.context.currentTime;
            if (this.nextStart > now + 0.3) return;
            const buffer = this.context.createBuffer(frame.numberOfChannels, frame.numberOfFrames, frame.sampleRate);
            for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
              frame.copyTo(buffer.getChannelData(channel), { planeIndex: channel, format: 'f32-planar' });
            }
            const source = this.context.createBufferSource();
            source.buffer = buffer;
            source.connect(this.gain);
            const start = Math.max(now + 0.01, this.nextStart);
            source.start(start);
            this.nextStart = start + buffer.duration;
          } catch {
            this.onError();
          } finally {
            frame.close();
          }
        },
        error: () => this.onError(),
      });
      this.decoder.configure({ codec: 'opus', sampleRate, numberOfChannels: channels });
      this.nextStart = 0;
    } catch {
      this.onError();
    }
  }

  push(packet: string): void {
    if (!this.decoder || this.decoder.state !== 'configured' || !shouldEnqueueAudio(this.decoder.decodeQueueSize)) return;
    const data = decodeAudioPacket(packet);
    if (!data) {
      this.onError();
      return;
    }
    try {
      this.decoder.decode(new EncodedAudioChunk({
        type: 'key',
        timestamp: Math.round(performance.now() * 1000),
        data,
      }));
    } catch {
      this.onError();
    }
  }

  close(): void {
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    this.decoder = null;
    this.nextStart = 0;
    void this.context.close().catch(() => undefined);
  }
}
