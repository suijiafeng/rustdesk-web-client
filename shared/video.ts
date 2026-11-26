import { Buffer } from 'buffer';
export const HEADER_LEN = 32;

export const CODEC_VP8 = 1;
export const CODEC_VP9 = 2;
export const CODEC_H264 = 3;
export const CODEC_H265 = 4;
export const CODEC_AV1 = 5;

export interface VideoPacket {
  codec: number;
  key: boolean;
  display: number;
  width: number;
  height: number;
  pts: bigint;
  gatewayUnixMs: bigint;
  data: Uint8Array;
}

const MAGIC_0 = 0x52; // 'R'
const MAGIC_1 = 0x44; // 'D'
const MAGIC_2 = 0x56; // 'V'
const MAGIC_3 = 0x31; // '1'

/**
 * Encodes a single encoded video frame into the 32-byte little-endian RDV1 binary format.
 */
export function encodeRdv1Frame(packet: VideoPacket): Buffer {
  const out = Buffer.allocUnsafe(HEADER_LEN + packet.data.byteLength);
  out[0] = MAGIC_0;
  out[1] = MAGIC_1;
  out[2] = MAGIC_2;
  out[3] = MAGIC_3;
  out[4] = packet.codec & 0xff;
  out[5] = packet.key ? 0x01 : 0x00;
  out.writeUInt16LE(packet.display & 0xffff, 6);
  out.writeUInt32LE(packet.width >>> 0, 8);
  out.writeUInt32LE(packet.height >>> 0, 12);
  out.writeBigInt64LE(packet.pts, 16);
  out.writeBigUInt64LE(packet.gatewayUnixMs, 24);
  Buffer.from(packet.data.buffer, packet.data.byteOffset, packet.data.byteLength).copy(
    out,
    HEADER_LEN,
  );
  return out;
}

/**
 * Decodes an RDV1 binary frame buffer. Returns null if too short or magic does not match.
 */
export function decodeRdv1Frame(buf: Uint8Array): VideoPacket | null {
  if (buf.byteLength < HEADER_LEN) return null;
  if (
    buf[0] !== MAGIC_0 ||
    buf[1] !== MAGIC_1 ||
    buf[2] !== MAGIC_2 ||
    buf[3] !== MAGIC_3
  ) {
    return null;
  }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  return {
    codec: view.getUint8(4),
    key: (view.getUint8(5) & 0x01) !== 0,
    display: view.getUint16(6, true),
    width: view.getUint32(8, true),
    height: view.getUint32(12, true),
    pts: view.getBigInt64(16, true),
    gatewayUnixMs: view.getBigUint64(24, true),
    data: buf.subarray(HEADER_LEN),
  };
}

/**
 * Parses width and height from a VP8 keyframe uncompressed data chunk header.
 * Returns null if the packet is not a VP8 keyframe or is truncated.
 */
export function vp8KeyframeSize(data: Uint8Array): { width: number; height: number } | null {
  if (data.byteLength < 10) return null;
  // Bit 0 of byte 0 is 0 for keyframes, 1 for interframes
  if ((data[0] & 0x01) !== 0) return null;
  // VP8 keyframe start code: 0x9d 0x01 0x2a
  if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) return null;
  const width = (data[6] | (data[7] << 8)) & 0x3fff;
  const height = (data[8] | (data[9] << 8)) & 0x3fff;
  if (width === 0 || height === 0) return null;
  return { width, height };
}

export interface EncodedFrame { data?: Uint8Array; key?: boolean; pts?: string | number }
export interface EncodedVideo {
  display?: number;
  rgb?: unknown;
  yuv?: unknown;
  vp8s?: { frames?: EncodedFrame[] };
  vp9s?: { frames?: EncodedFrame[] };
  h264s?: { frames?: EncodedFrame[] };
  h265s?: { frames?: EncodedFrame[] };
  av1s?: { frames?: EncodedFrame[] };
}

export function isH264AnnexBKeyframe(data: Uint8Array): boolean {
  const limit = Math.min(data.length, 4096);
  for (let i = 0; i + 4 < limit; i++) {
    if (data[i] === 0 && data[i + 1] === 0) {
      let nalOffset = -1;
      if (data[i + 2] === 1) {
        nalOffset = i + 3;
      } else if (data[i + 2] === 0 && data[i + 3] === 1) {
        nalOffset = i + 4;
      }
      if (nalOffset !== -1 && nalOffset < data.length) {
        const nalType = data[nalOffset] & 0x1f;
        // Require an IDR slice (5); parameter sets (SPS/PPS) alone are not decodable frames.
        if (nalType === 5) return true;
      }
    }
  }
  return false;
}

export function isVp9Keyframe(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  const b0 = data[0];
  // VP9 uncompressed header: frame_marker (2 bits) == 0b10
  if ((b0 >> 6) !== 2) return false;
  const profileLow = (b0 >> 5) & 1;
  const profileHigh = (b0 >> 4) & 1;
  const profile = (profileHigh << 1) | profileLow;
  // For profile 0..2: bit 3 is show_existing_frame (must be 0), bit 2 is frame_type (0 = key)
  if (profile < 3) {
    if ((b0 & 0x08) !== 0 || (b0 & 0x04) !== 0) return false;
    return data[1] === 0x49 && data[2] === 0x83 && data[3] === 0x42;
  }
  return false;
}

export function extractEncodedFrames(
  vf: EncodedVideo,
): { codec: number; frames: EncodedFrame[] } | null {
  if (vf.vp8s?.frames?.length) return { codec: CODEC_VP8, frames: vf.vp8s.frames };
  if (vf.vp9s?.frames?.length) return { codec: CODEC_VP9, frames: vf.vp9s.frames };
  if (vf.h264s?.frames?.length) return { codec: CODEC_H264, frames: vf.h264s.frames };
  if (vf.h265s?.frames?.length) return { codec: CODEC_H265, frames: vf.h265s.frames };
  if (vf.av1s?.frames?.length) return { codec: CODEC_AV1, frames: vf.av1s.frames };
  return null;
}


/** HEVC random-access pictures are BLA (16–18), IDR (19–20), or CRA (21).
 * Parameter sets alone do not make a picture independently decodable. */
export function isH265AnnexBKeyframe(data: Uint8Array): boolean {
  const limit = Math.min(data.length, 4096);
  for (let offset = 0; offset + 5 < limit; offset++) {
    if (data[offset] !== 0 || data[offset + 1] !== 0) continue;
    const header = data[offset + 2] === 1 ? offset + 3
      : data[offset + 2] === 0 && data[offset + 3] === 1 ? offset + 4 : -1;
    if (header < 0 || header + 2 >= data.length) continue;
    if ((data[header] & 0x80) !== 0 || (data[header + 1] & 7) === 0) continue;
    const type = (data[header] >> 1) & 0x3f;
    if (type >= 16 && type <= 21) return true;
  }
  return false;
}

export function encodedFrameIsKey(codec: number, data: Uint8Array, declaredKey = false): boolean {
  return Boolean(declaredKey) ||
    (codec === CODEC_VP8 && vp8KeyframeSize(data) !== null) ||
    (codec === CODEC_H264 && isH264AnnexBKeyframe(data)) ||
    (codec === CODEC_H265 && isH265AnnexBKeyframe(data)) ||
    (codec === CODEC_VP9 && isVp9Keyframe(data));
}
