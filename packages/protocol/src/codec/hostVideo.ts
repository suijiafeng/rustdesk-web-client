// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { CodecId, type CodecIdValue } from './rdv1.ts';

interface HostEncodedFrame {
  data?: Uint8Array | number[];
  key?: boolean;
  pts?: string | number | bigint;
}

interface HostEncodedVideo {
  frames?: HostEncodedFrame[];
}

export interface HostVideoFrame {
  display?: number;
  rgb?: { compress?: boolean };
  yuv?: { compress?: boolean; stride?: number };
  vp8s?: HostEncodedVideo;
  vp9s?: HostEncodedVideo;
  h264s?: HostEncodedVideo;
  h265s?: HostEncodedVideo;
  av1s?: HostEncodedVideo;
}

function isH264AnnexBKeyframe(data: Uint8Array): boolean {
  const limit = Math.min(data.length, 4096);
  for (let offset = 0; offset + 4 < limit; offset++) {
    if (data[offset] === 0 && data[offset + 1] === 0) {
      let nalOffset = -1;
      if (data[offset + 2] === 1) {
        nalOffset = offset + 3;
      } else if (data[offset + 2] === 0 && data[offset + 3] === 1) {
        nalOffset = offset + 4;
      }
      if (nalOffset !== -1 && nalOffset < data.length) {
        const nalType = data[nalOffset] & 0x1f;
        if (nalType === 5 || nalType === 7) return true; // IDR slice (5) or SPS (7)
      }
    }
  }
  return false;
}

function isVp9Keyframe(data: Uint8Array): boolean {
  if (data.length < 4) return false;
  const firstByte = data[0];
  // VP9 uncompressed header: frame_marker (2 bits) == 0b10
  if ((firstByte >> 6) !== 2) return false;
  const profileLow = (firstByte >> 5) & 1;
  const profileHigh = (firstByte >> 4) & 1;
  const profile = (profileHigh << 1) | profileLow;
  // For profile 0..2: bit 3 is show_existing_frame (must be 0), bit 2 is frame_type (0 = key)
  if (profile < 3) {
    if ((firstByte & 0x08) !== 0 || (firstByte & 0x04) !== 0) return false;
    return data[1] === 0x49 && data[2] === 0x83 && data[3] === 0x42;
  }
  return false;
}

export function getEncodedVideoFrames(
  videoFrame: HostVideoFrame,
): { codec: CodecIdValue; frames: HostEncodedFrame[] } | null {
  if (videoFrame.vp8s?.frames?.length) return { codec: CodecId.VP8, frames: videoFrame.vp8s.frames };
  if (videoFrame.vp9s?.frames?.length) return { codec: CodecId.VP9, frames: videoFrame.vp9s.frames };
  if (videoFrame.h264s?.frames?.length) return { codec: CodecId.H264, frames: videoFrame.h264s.frames };
  if (videoFrame.h265s?.frames?.length) return { codec: CodecId.H265, frames: videoFrame.h265s.frames };
  if (videoFrame.av1s?.frames?.length) return { codec: CodecId.AV1, frames: videoFrame.av1s.frames };
  return null;
}

export function isHostVideoKeyframe(codec: CodecIdValue, data: Uint8Array, reportedKeyframe?: boolean): boolean {
  return Boolean(reportedKeyframe)
    || (codec === CodecId.H264 && isH264AnnexBKeyframe(data))
    || (codec === CodecId.VP9 && isVp9Keyframe(data));
}
