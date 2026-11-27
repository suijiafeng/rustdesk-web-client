import { CursorPublisher } from '../shared/cursor.ts';
import { errorPayload } from '../shared/errors.ts';
import { dispatchCommonHostMessage, publishResolutions } from '../shared/hostSession.ts';
import { CursorShapes } from './cursor.ts';
import { decodeMessage, encodeMessage } from '../shared/protos.ts';
import type { ConnectedHost } from './rustdeskClient.ts';
import type { SessionContext } from './sessionState.ts';
import { AUDIO_QUEUE_LIMIT_BYTES } from './videoBuffer.ts';
import { peerToJson, initialDisplaySize } from '../shared/peer.ts';
import type { VideoFrameHandler } from './videoFrames.ts';

const MAX_PENDING_DELAY_PROBES = 8;

export async function startHostPump(
  conn: ConnectedHost,
  context: SessionContext,
  handleVideoFrame: VideoFrameHandler['handleFrame'],
): Promise<void> {
  const { state, ws, sendJson, sendBinary, cleanup } = context;
  let delayProbeSeq = 0;
  const cursorPublisher = new CursorPublisher(new CursorShapes(), state.cursorIds);
  state.cursorPublisher = cursorPublisher;
  state.currentSize = initialDisplaySize(conn.peerInfo);
  sendJson(peerToJson(conn.peerInfo, conn));
  publishResolutions(state, Number(conn.peerInfo.current_display ?? 0), conn.peerInfo.resolutions, sendJson);
  sendJson({
    type: 'status',
    state: 'live',
    detail: conn.encrypted ? 'encrypted' : 'direct',
    username: conn.username,
  });

  try {
    while (state.phase === 'live') {
      const raw = await conn.stream.next();
      if (!raw) {
        if (state.phase === 'live') {
          throw new Error('host closed the connection');
        }
        break;
      }
      const msg = decodeMessage(raw);

      // 1. TestDelay echo + RTT reporting
      // When delayEcho is negotiated, bounce probes across the browser WebSocket
      // behind queued video frames so RustDesk's VideoQoS sees true end-to-end delay.
      if (msg.test_delay && !msg.test_delay.from_client) {
        if (state.delayEcho) {
          const id = ++delayProbeSeq;
          const pending = state.pendingDelayProbes ??= new Map();
          if (pending.size >= MAX_PENDING_DELAY_PROBES) {
            const oldest = pending.keys().next().value;
            if (oldest !== undefined) pending.delete(oldest);
          }
          pending.set(id, msg.test_delay);
          sendJson({ type: 'delayProbe', id });
        } else {
          void conn.stream.sendRaw(encodeMessage({ test_delay: msg.test_delay })).catch(() => {});
        }
        const lastDelay = Number(msg.test_delay.last_delay ?? 0);
        if (lastDelay > 0) {
          sendJson({ type: 'rtt', ms: lastDelay });
        }
      }

      // 2-4b. Misc control events, permissions, audio, clipboard, cursor, and PeerInfo
      const closed = dispatchCommonHostMessage(msg, conn, state, {
        sendJson,
        cursorPublisher,
        audioBinary: state.audioBinary,
        canSendAudio: () => ws.bufferedAmount < AUDIO_QUEUE_LIMIT_BYTES,
        onAudioFrame: sendBinary,
        onAudioBase64: (packet) => sendJson({ type: 'audioFrame', packet: Buffer.from(packet).toString('base64') }),
        onCloseReason: (reason) => {
          sendJson({ type: 'status', state: 'error', ...errorPayload(reason) });
          // Appendix B fix #8: actively close the stream on close_reason
          cleanup(false);
        },
      });
      if (closed) return;

      // 5. VideoFrame
      if (msg.video_frame) {
        handleVideoFrame(conn, msg.video_frame);
      }
    }
  } catch (err) {
    if (state.phase === 'live') {
      sendJson({ type: 'status', state: 'error', ...errorPayload(err) });
      cleanup(false);
    }
  }
}
