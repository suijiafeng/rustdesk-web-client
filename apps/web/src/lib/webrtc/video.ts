// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { CodecId, encodeRdv1Frame, getEncodedVideoFrames, isHostVideoKeyframe, vp8KeyframeSize, type HostVideoFrame } from '@rustdesk-web/protocol';
import type { ServerMessage } from '@rustdesk-web/shared';

export function createNativeVideo(
  sendEvent: (event: ServerMessage) => void,
  sendFrame: (frame: Uint8Array) => void,
) {
  let displaySize = { width: 0, height: 0 };
  let warnedAboutRawVideo = false;

  function handleVideoFrame(videoFrame: HostVideoFrame): boolean {
    if ((videoFrame.rgb || videoFrame.yuv) && !warnedAboutRawVideo) {
      warnedAboutRawVideo = true;
      sendEvent({
        type: 'error',
        message: 'the host sent uncompressed video; this client only decodes vp8, vp9, h264, h265, and av1',
      });
    }

    const encoded = getEncodedVideoFrames(videoFrame);
    if (!encoded) return false;

    const display = Math.max(0, Number(videoFrame.display ?? 0));
    const receivedAt = BigInt(Date.now());
    for (const frame of encoded.frames) {
      const payload = frame.data ? new Uint8Array(frame.data) : new Uint8Array(0);
      const isKeyframe = isHostVideoKeyframe(encoded.codec, payload, frame.key);
      if (encoded.codec === CodecId.VP8 && isKeyframe) {
        displaySize = vp8KeyframeSize(payload) ?? displaySize;
      }
      sendFrame(encodeRdv1Frame({
        codec: encoded.codec,
        key: isKeyframe,
        display,
        width: displaySize.width,
        height: displaySize.height,
        pts: BigInt(frame.pts ?? 0),
        gatewayUnixMs: receivedAt,
        data: payload,
      }));
    }
    return true;
  }

  return {
    handleVideoFrame,
    setDisplaySize: (size: typeof displaySize) => { displaySize = size; },
  };
}
