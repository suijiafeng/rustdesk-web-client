import { errorPayload } from '../shared/errors.ts';
import { buildRefreshVideoMessage, buildVideoReceivedMessage, humanizeError } from '../shared/control.ts';
import { encodeMessage } from '../shared/protos.ts';
import type { ConnectedHost } from './rustdeskClient.ts';
import type { SessionContext } from './sessionState.ts';
import {
  CODEC_VP8,
  encodedFrameIsKey, extractEncodedFrames, type EncodedVideo,
  HEADER_LEN, encodeRdv1Frame, vp8KeyframeSize,
} from '../shared/video.ts';

export interface VideoFrameHandler {
  handleFrame: (conn: ConnectedHost, vf: EncodedVideo) => void;
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
            sendJson({ type: 'status', state: 'error', ...errorPayload(err) });
            cleanup(false);
          }
        });
      }
      scheduleVideoRecovery(conn);
    }, 250);
    recoveryTimer.unref?.();
  };

  const handleFrame = (conn: ConnectedHost, vf: EncodedVideo) => {
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
        const isKey = encodedFrameIsKey(extracted.codec, payload, f.key);
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
