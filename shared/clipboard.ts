import { decompress } from 'fzstd';
import { zstdFrameSize } from './compression.ts';

export const MAX_CLIPBOARD_BYTES = 256 * 1024;
interface ClipboardData { format?: number; compress?: boolean; content?: Uint8Array }

export function decodeClipboard(clip: ClipboardData | undefined): string | null {
  if (!clip?.content || Number(clip.format ?? 0) !== 0 || clip.content.byteLength > MAX_CLIPBOARD_BYTES) return null;
  try {
    let bytes = clip.content;
    if (clip.compress) {
      const size = zstdFrameSize(bytes, MAX_CLIPBOARD_BYTES);
      if (size === null) return null;
      bytes = decompress(bytes, new Uint8Array(size));
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
