// RustDesk encodes a single zstd frame with its original size. Check that frame
// before decoding into a bounded buffer, including rejecting concatenated frames.
export function zstdFrameSize(data: Uint8Array, maxBytes: number): number | null {
  if (data.length < 6 || data[0] !== 0x28 || data[1] !== 0xb5 || data[2] !== 0x2f || data[3] !== 0xfd) return null;
  const flag = data[4];
  if (flag & 8) return null;
  const single = (flag >> 5) & 1;
  const dict = flag & 3;
  const sizeFlag = flag >> 6;
  const sizeBytes = sizeFlag ? 2 ** sizeFlag : single;
  if (!sizeBytes) return null;
  let offset = 6 - single + (dict === 3 ? 4 : dict);
  if (offset + sizeBytes > data.length) return null;
  let size = sizeFlag === 1 ? 256 : 0;
  for (let i = 0; i < sizeBytes; i++) size += data[offset++] * 2 ** (8 * i);
  if (!Number.isSafeInteger(size) || size > maxBytes) return null;
  let last = false;
  while (!last) {
    if (offset + 3 > data.length) return null;
    const header = data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16;
    offset += 3;
    last = Boolean(header & 1);
    const type = (header >> 1) & 3;
    if (type === 3) return null;
    offset += type === 1 ? 1 : header >> 3;
    if (offset > data.length) return null;
  }
  if (flag & 4) offset += 4;
  return offset === data.length ? size : null;
}
