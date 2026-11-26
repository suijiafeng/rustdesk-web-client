import { CODEC_AV1, CODEC_H264, CODEC_H265, CODEC_VP8, CODEC_VP9 } from './video.ts';

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
        if (nalType === 5 || nalType === 7) return true; // IDR slice (5) or SPS (7)
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
  vf: Record<string, any>,
): { codec: number; frames: any[] } | null {
  if (vf.vp8s?.frames?.length) return { codec: CODEC_VP8, frames: vf.vp8s.frames };
  if (vf.vp9s?.frames?.length) return { codec: CODEC_VP9, frames: vf.vp9s.frames };
  if (vf.h264s?.frames?.length) return { codec: CODEC_H264, frames: vf.h264s.frames };
  if (vf.h265s?.frames?.length) return { codec: CODEC_H265, frames: vf.h265s.frames };
  if (vf.av1s?.frames?.length) return { codec: CODEC_AV1, frames: vf.av1s.frames };
  return null;
}

