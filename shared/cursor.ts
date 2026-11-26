import { Buffer } from 'buffer';
import { decompress } from 'fzstd';
import { zstdFrameSize } from './compression.ts';

const MAX_CURSOR_SIDE = 512;
const MAX_CURSOR_CACHE_ENTRIES = 16;
const MAX_CURSOR_CACHE_BYTES = 4 * 1024 * 1024;

export interface CursorShape {
  width: number;
  height: number;
  hotX: number;
  hotY: number;
  rgba: string;
}

export interface CursorData {
  id?: string;
  width?: number;
  height?: number;
  hotx?: number;
  hoty?: number;
  colors?: Uint8Array;
}

export class CursorShapes {
  private readonly cache = new Map<string, CursorShape>();
  private cacheBytes = 0;

  constructor(private readonly decodePixels = (data: Uint8Array, expectedBytes: number): Uint8Array =>
    decompress(data, new Uint8Array(expectedBytes))) {}

  get(id: string): CursorShape | null {
    return this.cache.get(id) ?? null;
  }

  decode(data: CursorData): CursorShape | null {
    const { id = '0', width = 0, height = 0, hotx = 0, hoty = 0, colors } = data;
    this.remove(id);
    if (
      !Number.isInteger(width) || !Number.isInteger(height) ||
      width < 1 || width > MAX_CURSOR_SIDE || height < 1 || height > MAX_CURSOR_SIDE ||
      !colors?.byteLength || colors.byteLength > 1024 * 1024
    ) {
      return null;
    }

    const expectedBytes = width * height * 4;
    if (zstdFrameSize(colors, expectedBytes) !== expectedBytes) return null;
    let rgba: Buffer;
    try {
      rgba = Buffer.from(this.decodePixels(colors, expectedBytes));
    } catch {
      return null;
    }
    if (rgba.byteLength !== expectedBytes) return null;

    const shape = {
      width,
      height,
      hotX: Math.max(0, Math.min(width - 1, hotx)),
      hotY: Math.max(0, Math.min(height - 1, hoty)),
      rgba: rgba.toString('base64'),
    };
    for (const key of this.cache.keys()) {
      if (
        this.cache.size < MAX_CURSOR_CACHE_ENTRIES &&
        this.cacheBytes + shape.rgba.length <= MAX_CURSOR_CACHE_BYTES
      ) break;
      this.remove(key);
    }
    this.cache.set(id, shape);
    this.cacheBytes += shape.rgba.length;
    return shape;
  }

  private remove(id: string): void {
    const previous = this.cache.get(id);
    if (previous) {
      this.cacheBytes -= previous.rgba.length;
      this.cache.delete(id);
    }
  }
}
