// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { CodecId, decodeRdv1Frame, encodeRdv1Frame, FRAME_HEADER_LENGTH } from '@rustdesk-web/protocol';

export const HEADER_LEN = FRAME_HEADER_LENGTH;
export const CODEC_VP8 = CodecId.VP8;
export const CODEC_VP9 = CodecId.VP9;
export const CODEC_H264 = CodecId.H264;
export const CODEC_H265 = CodecId.H265;
export const CODEC_AV1 = CodecId.AV1;
export { decodeRdv1Frame, encodeRdv1Frame };

/** Drop delta frames once the browser socket is this far behind, so video cannot grow without a bound. */
export const MAX_VIDEO_BUFFERED_BYTES = 1024 * 1024;

export function shouldSendVideoFrame(
  bufferedAmount: number,
  isKey: boolean,
  limit = MAX_VIDEO_BUFFERED_BYTES,
): boolean {
  if (isKey) return true;
  return bufferedAmount < limit;
}

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
