import { buildRefreshVideoMessage, buildVideoReceivedMessage, humanizeError } from './control.ts';
import { encodeMessage } from './protos.ts';
import type { ConnectedHost } from './rustdeskClient.ts';
import type { SessionContext } from './sessionState.ts';
import {
  CODEC_AV1, CODEC_H264, CODEC_H265, CODEC_VP8, CODEC_VP9,
  HEADER_LEN, encodeRdv1Frame, vp8KeyframeSize,
} from './video.ts';

function isH264AnnexBKeyframe(data: Uint8Array): boolean {
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

function isVp9Keyframe(data: Uint8Array): boolean {
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

function extractEncodedFrames(
  vf: Record<string, any>,
): { codec: number; frames: any[] } | null {
  if (vf.vp8s?.frames?.length) return { codec: CODEC_VP8, frames: vf.vp8s.frames };
  if (vf.vp9s?.frames?.length) return { codec: CODEC_VP9, frames: vf.vp9s.frames };
  if (vf.h264s?.frames?.length) return { codec: CODEC_H264, frames: vf.h264s.frames };
  if (vf.h265s?.frames?.length) return { codec: CODEC_H265, frames: vf.h265s.frames };
  if (vf.av1s?.frames?.length) return { codec: CODEC_AV1, frames: vf.av1s.frames };
  return null;
}

export interface VideoFrameHandler {
  handleFrame: (conn: ConnectedHost, vf: Record<string, any>) => void;
  dispose: () => void;
}

export function createVideoFrameHandler(context: SessionContext): VideoFrameHandler {
  const { state, ws, videoBuffer, sendJson, sendBinary, cleanup } = context;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let warnedRawVideo = false;

  const scheduleVideoRecovery = (conn: ConnectedHost) => {
    if (recoveryTimer || !videoBuffer.needsRefresh) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined;
      if (state.phase !== 'live' || state.hostConn !== conn || !videoBuffer.needsRefresh) return;
      if (videoBuffer.shouldRequestRefresh(ws.bufferedAmount, performance.now())) {
        void conn.stream.sendRaw(encodeMessage(buildRefreshVideoMessage())).catch((err) => {
          if (state.phase === 'live' && state.hostConn === conn) {
            sendJson({ type: 'status', state: 'error', detail: humanizeError(err) });
            cleanup(false);
          }
        });
      }
      scheduleVideoRecovery(conn);
    }, 250);
    recoveryTimer.unref?.();
  };

  const handleFrame = (conn: ConnectedHost, vf: Record<string, any>) => {
    if ((vf.rgb || vf.yuv) && !warnedRawVideo) {
      warnedRawVideo = true;
      sendJson({
        type: 'error',
        message:
          'the host sent uncompressed video; this client only decodes vp8, vp9, h264, h265, and av1',
      });
    }

    const extracted = extractEncodedFrames(vf);
    if (extracted) {
      const display = Math.max(0, Number(vf.display ?? 0));
      const nowMs = BigInt(Date.now());
      for (const f of extracted.frames) {
        const payload = f.data ? new Uint8Array(f.data) : new Uint8Array(0);
        const isKey =
          Boolean(f.key) ||
          (extracted.codec === CODEC_H264 && isH264AnnexBKeyframe(payload)) ||
          (extracted.codec === CODEC_VP9 && isVp9Keyframe(payload));
        if (extracted.codec === CODEC_VP8 && isKey) {
          const parsedSize = vp8KeyframeSize(payload);
          if (parsedSize) {
            state.currentSize = parsedSize;
          }
        }
        if (!videoBuffer.shouldForward(display, isKey, payload.byteLength + HEADER_LEN, ws.bufferedAmount)) {
          scheduleVideoRecovery(conn);
          continue;
        }
        const pts = BigInt(f.pts ?? 0);
        const packet = encodeRdv1Frame({
          codec: extracted.codec,
          key: isKey,
          display,
          width: state.currentSize.width,
          height: state.currentSize.height,
          pts,
          gatewayUnixMs: nowMs,
          data: payload,
        });
        sendBinary(packet);
      }
      // RustDesk 1.5 QoS ACK once per message containing video frames (non-blocking)
      void conn.stream
        .sendRaw(encodeMessage(buildVideoReceivedMessage()))
        .catch(() => {});
    }
  };

  return { handleFrame, dispose: () => clearTimeout(recoveryTimer) };
}
