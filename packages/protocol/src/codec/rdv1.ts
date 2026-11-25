// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

/** Byte length of an RDV1 video frame header. */
export const FRAME_HEADER_LENGTH = 32;

export const CodecId = {
  VP8: 1,
  VP9: 2,
  H264: 3,
  H265: 4,
  AV1: 5,
} as const;

export type CodecIdValue = (typeof CodecId)[keyof typeof CodecId];

const CODEC_NAMES: Record<number, string> = {
  1: 'vp8',
  2: 'vp9',
  3: 'h264',
  4: 'h265',
  5: 'av1',
};

export interface Rdv1Frame {
  codec: number;
  key: boolean;
  display: number;
  width: number;
  height: number;
  pts: bigint;
  gatewayUnixMs: bigint;
  data: Uint8Array;
}

export function hasRoomForHeader(byteLength: number): boolean {
  return Number.isInteger(byteLength) && byteLength >= FRAME_HEADER_LENGTH;
}

export function codecName(codec: number): string {
  return CODEC_NAMES[codec] ?? 'unknown';
}

export function encodeRdv1Frame(frame: Rdv1Frame): Uint8Array {
  const out = new Uint8Array(FRAME_HEADER_LENGTH + frame.data.byteLength);
  out[0] = 0x52;
  out[1] = 0x44;
  out[2] = 0x56;
  out[3] = 0x31;
  out[4] = frame.codec & 0xff;
  out[5] = frame.key ? 0x01 : 0x00;
  const view = new DataView(out.buffer);
  view.setUint16(6, frame.display & 0xffff, true);
  view.setUint32(8, frame.width >>> 0, true);
  view.setUint32(12, frame.height >>> 0, true);
  view.setBigInt64(16, frame.pts, true);
  view.setBigUint64(24, frame.gatewayUnixMs, true);
  out.set(frame.data, FRAME_HEADER_LENGTH);
  return out;
}

export function decodeRdv1Frame(bytes: Uint8Array): Rdv1Frame | null {
  if (!hasRoomForHeader(bytes.byteLength)) return null;
  if (bytes[0] !== 0x52 || bytes[1] !== 0x44 || bytes[2] !== 0x56 || bytes[3] !== 0x31) {
    return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    codec: view.getUint8(4),
    key: (view.getUint8(5) & 0x01) !== 0,
    display: view.getUint16(6, true),
    width: view.getUint32(8, true),
    height: view.getUint32(12, true),
    pts: view.getBigInt64(16, true),
    gatewayUnixMs: view.getBigUint64(24, true),
    data: bytes.subarray(FRAME_HEADER_LENGTH),
  };
}
