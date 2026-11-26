export const AUDIO_START_MS = 40;
export const AUDIO_MAX_TARGET_MS = 120;
export const AUDIO_MAX_LATENCY_MS = 200;
export const AUDIO_FADE_MS = 5;

/** Fixed-size stereo PCM queue. All deadlines use the AudioContext clock. */
export class PcmJitterBuffer {
  private readonly left: Float32Array;
  private readonly right: Float32Array;
  private readonly expires: Float64Array;
  private readonly capacity: number;
  private readonly fadeFrames: number;
  private head = 0;
  private size = 0;
  private playing = false;
  private target: number;
  private stableFrames = 0;
  private lastLeft = 0;
  private lastRight = 0;
  private fadeLeft = 0;
  private fadeRight = 0;
  private fading = 0;
  private tail = 0;
  private sourceRate = 0;
  private sourceFrames = 0;
  private nextSourceFrame = 0;
  private previousLeft = 0;
  private previousRight = 0;
  underruns = 0;
  droppedFrames = 0;

  constructor(readonly sampleRate: number) {
    if (!Number.isFinite(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Invalid audio sample rate');
    this.capacity = Math.ceil(sampleRate * AUDIO_MAX_LATENCY_MS / 1000);
    this.fadeFrames = Math.max(1, Math.round(sampleRate * AUDIO_FADE_MS / 1000));
    this.target = Math.ceil(sampleRate * AUDIO_START_MS / 1000);
    this.left = new Float32Array(this.capacity);
    this.right = new Float32Array(this.capacity);
    this.expires = new Float64Array(this.capacity);
  }

  get queuedFrames() { return this.size; }
  get targetFrames() { return this.target; }

  reset(): void {
    this.head = this.size = this.stableFrames = 0;
    this.playing = false;
    this.target = Math.ceil(this.sampleRate * AUDIO_START_MS / 1000);
    this.sourceRate = this.sourceFrames = this.nextSourceFrame = 0;
    this.previousLeft = this.previousRight = 0;
    this.lastLeft = this.lastRight = this.fadeLeft = this.fadeRight = 0;
    this.fading = this.tail = 0;
  }

  private transition(): void {
    this.fadeLeft = this.lastLeft;
    this.fadeRight = this.lastRight;
    this.fading = this.fadeFrames;
  }

  private discard(count: number): void {
    const skipped = Math.min(this.size, count);
    this.head = (this.head + skipped) % this.capacity;
    this.size -= skipped;
    this.droppedFrames += skipped;
    if (skipped) this.transition();
  }

  push(planes: Float32Array[], inputRate: number, receivedAt = Infinity): void {
    const frames = planes[0]?.length ?? 0;
    if (!frames || planes.length < 1 || planes.length > 2 ||
        planes.some(plane => plane.length !== frames) ||
        !Number.isFinite(inputRate) || inputRate < 8000 || inputRate > 192000) {
      throw new Error('Invalid PCM format');
    }
    if (this.sourceRate !== inputRate) {
      this.sourceRate = inputRate;
      this.sourceFrames = this.nextSourceFrame = 0;
      this.transition();
    }
    const estimated = Math.ceil(frames * this.sampleRate / inputRate);
    if (this.size + estimated > this.capacity) {
      const keep = Math.max(this.target, Math.ceil(this.sampleRate * 0.06));
      this.discard(Math.max(0, this.size + estimated - keep));
    }
    const left = planes[0];
    const right = planes[1] ?? left;
    const end = this.sourceFrames + frames - 1;
    const step = inputRate / this.sampleRate;
    const expiry = receivedAt + AUDIO_MAX_LATENCY_MS / 1000;
    // Preserve interpolation phase across packets; resetting it per packet drifts.
    while (this.nextSourceFrame <= end) {
      const position = this.nextSourceFrame - this.sourceFrames;
      const index = Math.floor(position);
      const fraction = position - index;
      const aLeft = index < 0 ? this.previousLeft : left[index];
      const aRight = index < 0 ? this.previousRight : right[index];
      const bLeft = fraction ? left[index + 1] : aLeft;
      const bRight = fraction ? right[index + 1] : aRight;
      if (this.size === this.capacity) this.discard(1);
      const tail = (this.head + this.size) % this.capacity;
      const l = aLeft + (bLeft - aLeft) * fraction;
      const r = aRight + (bRight - aRight) * fraction;
      this.left[tail] = Number.isFinite(l) ? Math.max(-1, Math.min(1, l)) : 0;
      this.right[tail] = Number.isFinite(r) ? Math.max(-1, Math.min(1, r)) : 0;
      this.expires[tail] = expiry;
      this.size++;
      this.nextSourceFrame += step;
    }
    this.previousLeft = left[frames - 1];
    this.previousRight = right[frames - 1];
    this.sourceFrames += frames;
  }

  /** Fills one render quantum without allocating or creating AudioNodes. */
  render(output: Float32Array[], now = 0): void {
    const frames = output[0]?.length ?? 0;
    for (let index = 0; index < frames; index++) {
      let expired = 0;
      while (expired < this.size && this.expires[(this.head + expired) % this.capacity] < now + index / this.sampleRate) expired++;
      if (expired) this.discard(expired);
      if (!this.playing && this.size >= this.target) {
        this.playing = true;
        this.tail = 0;
        this.transition();
      }
      let l = 0;
      let r = 0;
      if (this.playing && this.size) {
        l = this.left[this.head];
        r = this.right[this.head];
        this.head = (this.head + 1) % this.capacity;
        this.size--;
        if (this.fading) {
          const blend = 1 - this.fading-- / this.fadeFrames;
          l = this.fadeLeft + (l - this.fadeLeft) * blend;
          r = this.fadeRight + (r - this.fadeRight) * blend;
        }
        if (++this.stableFrames >= this.sampleRate * 5) {
          const step = Math.round(this.sampleRate * 0.01);
          this.target = Math.max(Math.ceil(this.sampleRate * AUDIO_START_MS / 1000), this.target - step);
          // Lowering the next startup threshold alone leaves a live FIFO's delay
          // unchanged. Gently remove excess queued audio as stability returns.
          if (this.size > this.target) {
            this.discard(Math.min(step, this.size - this.target));
            this.fadeLeft = l;
            this.fadeRight = r;
          }
          this.stableFrames = 0;
        }
      } else {
        if (this.playing) {
          this.playing = false;
          this.underruns++;
          this.stableFrames = 0;
          this.target = Math.min(Math.ceil(this.sampleRate * AUDIO_MAX_TARGET_MS / 1000), this.target + Math.round(this.sampleRate * 0.02));
          this.fadeLeft = this.lastLeft;
          this.fadeRight = this.lastRight;
          this.tail = this.fadeFrames;
        }
        if (this.tail) {
          const gain = --this.tail / this.fadeFrames;
          l = this.fadeLeft * gain;
          r = this.fadeRight * gain;
        }
      }
      this.lastLeft = l;
      this.lastRight = r;
      for (let channel = 0; channel < output.length; channel++) output[channel][index] = channel === 0 ? l : r;
    }
  }
}
