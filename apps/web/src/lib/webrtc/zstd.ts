// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { Decompress } from 'fzstd';

const MAX_WINDOW_BYTES = 8 * 1024 * 1024;

// Verify one full frame before allowing fzstd to allocate its sliding window.
// Frames from a streaming encoder may omit the original content size.
function readFrameSize(data: Uint8Array, limit: number): number | undefined {
  if (data.length < 6 || data[0] !== 0x28 || data[1] !== 0xb5 || data[2] !== 0x2f || data[3] !== 0xfd) return;
  const flags = data[4];
  if (flags & 8 || flags & 3) return;
  const singleSegment = (flags & 32) !== 0;
  const sizeFlag = flags >> 6;
  const sizeBytes = sizeFlag ? 2 ** sizeFlag : Number(singleSegment);
  let offset = singleSegment ? 5 : 6;
  if (offset + sizeBytes > data.length) return;
  let size = sizeFlag === 1 ? 256 : 0;
  for (let i = 0; i < sizeBytes; i++) size += data[offset++] * 2 ** (8 * i);
  const window = singleSegment ? size : 2 ** (10 + (data[5] >> 3)) * (1 + (data[5] & 7) / 8);
  if (size > limit || window > MAX_WINDOW_BYTES) return;

  let last = false;
  while (!last) {
    if (offset + 3 > data.length) return;
    const header = data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16;
    last = Boolean(header & 1);
    const type = (header >> 1) & 3;
    if (type === 3) return;
    offset += 3 + (type === 1 ? 1 : header >> 3);
    if (offset > data.length) return;
  }
  if (flags & 4) offset += 4;
  if (offset === data.length) return sizeBytes ? size : -1;
}

export function decompressZstd(data: Uint8Array, limit: number): Uint8Array | null {
  const declared = readFrameSize(data, limit);
  if (declared === undefined) return null;
  const output = new Uint8Array(declared < 0 ? limit : declared);
  let offset = 0;
  try {
    const decoder = new Decompress((chunk) => {
      output.set(chunk, offset);
      offset += chunk.length;
    });
    decoder.push(data, true);
    return declared < 0 || offset === declared ? output.subarray(0, offset) : null;
  } catch {
    return null;
  }
}
