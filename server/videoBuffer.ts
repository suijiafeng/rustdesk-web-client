const VIDEO_QUEUE_LIMIT_BYTES = 1024 * 1024;
const VIDEO_RESUME_BYTES = 256 * 1024;
const REFRESH_INTERVAL_MS = 1000;

export class GatewayVideoBuffer {
  private waitingForKey = new Set<number>();
  private refreshPending = false;
  private lastRefreshAt = -Infinity;
  droppedFrames = 0;

  get recovering(): boolean {
    return this.waitingForKey.size > 0;
  }

  get needsRefresh(): boolean {
    return this.refreshPending && this.recovering;
  }

  shouldForward(display: number, key: boolean, frameBytes: number, queuedBytes: number): boolean {
    const waiting = this.waitingForKey.has(display);
    // Allow one large frame when the queue is empty, including high-resolution keyframes.
    const full = queuedBytes > 0 && queuedBytes + frameBytes > VIDEO_QUEUE_LIMIT_BYTES;
    if (full || (waiting && (!key || queuedBytes > VIDEO_RESUME_BYTES))) {
      this.waitingForKey.add(display);
      this.refreshPending = true;
      this.droppedFrames++;
      return false;
    }
    if (waiting) {
      this.waitingForKey.delete(display);
      if (!this.recovering) this.refreshPending = false;
    }
    return true;
  }

  shouldRequestRefresh(queuedBytes: number, now: number): boolean {
    if (!this.needsRefresh || queuedBytes > VIDEO_RESUME_BYTES ||
        now - this.lastRefreshAt < REFRESH_INTERVAL_MS) return false;
    this.refreshPending = false;
    this.lastRefreshAt = now;
    return true;
  }
}
