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

export { vp8KeyframeSize } from '@rustdesk-web/protocol';
