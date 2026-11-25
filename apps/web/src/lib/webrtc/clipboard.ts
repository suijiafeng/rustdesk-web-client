// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { decompressZstd } from './zstd.ts';

export const MAX_CLIPBOARD_BYTES = 256 * 1024;
interface ClipboardData { format?: number; compress?: boolean; content?: Uint8Array | number[] }

export function decodeClipboard(clip: ClipboardData | undefined): string | null {
  if (!clip?.content || Number(clip.format ?? 0) !== 0 || clip.content.length > MAX_CLIPBOARD_BYTES) return null;
  try {
    const content = Uint8Array.from(clip.content);
    const bytes = clip.compress ? decompressZstd(content, MAX_CLIPBOARD_BYTES) : content;
    if (!bytes) return null;
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
