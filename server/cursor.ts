import { zstdDecompressSync } from 'node:zlib';
import { CursorShapes as SharedCursorShapes } from '../shared/cursor.ts';

// Keep native decompression on the gateway; shape validation and caching are shared.
export class CursorShapes extends SharedCursorShapes {
  constructor() {
    super((data, maxOutputLength) => zstdDecompressSync(data, { maxOutputLength }));
  }
}
