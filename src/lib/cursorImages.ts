import { MAX_CURSOR_CACHE_BYTES, MAX_CURSOR_CACHE_ENTRIES, MAX_CURSOR_SIDE, type CursorMessage } from '../../shared/cursor';

export interface CursorImage { pixels: ImageData; hotX: number; hotY: number }

/** One cache per socket. Budget by transmitted bitmap size to match the sender. */
export class CursorImages {
  private entries = new Map<string, { image: CursorImage; bytes: number }>();
  private pending = new Set<string>();
  private bytes = 0;

  constructor(private request: (id: string) => void) {}

  receive(message: Extract<CursorMessage, { type: 'cursorShape' }>): CursorImage | null {
    if (Array.isArray(message.evictedIds)) {
      for (const id of message.evictedIds.slice(0, MAX_CURSOR_CACHE_ENTRIES)) if (typeof id === 'string') this.remove(id);
    }
    const id = typeof message.id === 'string' && message.id.length <= 128 ? message.id : undefined;
    if (id !== undefined) { this.pending.delete(id); this.remove(id); }
    const shape = message.shape;
    if (!shape) return null;
    const { width, height, hotX, hotY, rgba } = shape;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        width > MAX_CURSOR_SIDE || height > MAX_CURSOR_SIDE || typeof rgba !== 'string' ||
        rgba.length !== 4 * Math.ceil(width * height * 4 / 3)) return null;
    try {
      const pixels = Uint8ClampedArray.from(atob(rgba), character => character.charCodeAt(0));
      if (pixels.length !== width * height * 4 || !Number.isFinite(hotX) || !Number.isFinite(hotY)) return null;
      const image = { pixels: new ImageData(pixels, width, height), hotX, hotY };
      if (id !== undefined) {
        for (const key of this.entries.keys()) {
          if (this.entries.size < MAX_CURSOR_CACHE_ENTRIES && this.bytes + rgba.length <= MAX_CURSOR_CACHE_BYTES) break;
          this.remove(key);
        }
        this.entries.set(id, { image, bytes: rgba.length });
        this.bytes += rgba.length;
      }
      return image;
    } catch { return null; }
  }

  select(id: string): CursorImage | null {
    if (typeof id !== 'string' || id.length > 128) return null;
    const image = this.entries.get(id)?.image;
    if (image) return image;
    if (!this.pending.has(id)) {
      if (this.pending.size >= MAX_CURSOR_CACHE_ENTRIES) this.pending.delete(this.pending.values().next().value!);
      this.pending.add(id);
      this.request(id);
    }
    return null;
  }

  clear(): void { this.entries.clear(); this.pending.clear(); this.bytes = 0; }

  private remove(id: string): void {
    const entry = this.entries.get(id);
    if (entry) { this.bytes -= entry.bytes; this.entries.delete(id); }
  }
}
