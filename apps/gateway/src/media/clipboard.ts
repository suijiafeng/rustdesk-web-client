// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { constants, zstdDecompressSync } from 'node:zlib';

const MAX_CLIPBOARD_BYTES = 256 * 1024;
const decoder = new TextDecoder('utf-8', { fatal: true });

export function decodeClipboardText(clip?: { format?: number; compress?: boolean; content?: Uint8Array } | null): string | null {
  const content = clip?.content;
  if (!clip || !content?.byteLength || content.byteLength > MAX_CLIPBOARD_BYTES || Number(clip.format ?? 0) !== 0) {
    return null;
  }
  try {
    const bytes = clip.compress ? zstdDecompressSync(content, {
      maxOutputLength: MAX_CLIPBOARD_BYTES,
      params: { [constants.ZSTD_d_windowLogMax]: 18 },
    }) : content;
    return decoder.decode(bytes) || null;
  } catch {
    return null;
  }
}
