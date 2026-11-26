import { encodeAudioFrame } from '../shared/audio.ts';
import { CursorPublisher } from '../shared/cursor.ts';
import { errorPayload } from '../shared/errors.ts';
import { decodeClipboard } from '../shared/clipboard.ts';
import { CursorShapes } from './cursor.ts';
import { decodeMessage, encodeMessage } from '../shared/protos.ts';
import type { ConnectedHost } from './rustdeskClient.ts';
import type { SessionContext } from './sessionState.ts';
import { AUDIO_QUEUE_LIMIT_BYTES } from './videoBuffer.ts';
import { canRestart, permissions, peerToJson, initialDisplaySize, HostPermission, PrivacyState, privacyResult, supportedResolutions, type PeerInfo } from '../shared/peer.ts';
import type { VideoFrameHandler } from './videoFrames.ts';

const MAX_PENDING_DELAY_PROBES = 8;

export async function startHostPump(
  conn: ConnectedHost,
  context: SessionContext,
  handleVideoFrame: VideoFrameHandler['handleFrame'],
): Promise<void> {
  const { state, ws, sendJson, sendBinary, cleanup } = context;
  let delayProbeSeq = 0;
  const publishResolutions = (display: number, supported?: PeerInfo['resolutions']) => {
    state.resolutionDisplay = display;
    state.sizes = supportedResolutions(supported);
    sendJson({ type: 'resolutions', display, sizes: state.sizes });
  };
  const cursorPublisher = new CursorPublisher(new CursorShapes(), state.cursorIds);
  state.cursorPublisher = cursorPublisher;
  state.currentSize = initialDisplaySize(conn.peerInfo);
  sendJson(peerToJson(conn.peerInfo, conn));
  publishResolutions(Number(conn.peerInfo.current_display ?? 0), conn.peerInfo.resolutions);
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

      // 2. Misc control events
      if (msg.misc) {
        if (Number.isInteger(msg.misc.follow_current_display)) {
          sendJson({ type: 'focusedDisplay', display: msg.misc.follow_current_display });
        }
        if (msg.misc.switch_display) {
          const sd = msg.misc.switch_display;
          const w = Number(sd.width ?? 0);
          const h = Number(sd.height ?? 0);
          if (w > 0 && h > 0) {
            state.currentSize = { width: w, height: h };
          }
          sendJson({
            type: 'display',
            display: Number(sd.display ?? 0),
            width: w,
            height: h,
            x: Number(sd.x ?? 0),
            y: Number(sd.y ?? 0),
            cursorEmbedded: Boolean(sd.cursor_embedded),
            name: '',
          });
          publishResolutions(Number(sd.display ?? 0), sd.resolutions);
        }
        if (msg.misc.close_reason) {
          const reason = String(msg.misc.close_reason);
          sendJson({ type: 'status', state: 'error', ...errorPayload(reason) });
          // Appendix B fix #8: actively close the stream on close_reason
          cleanup(false);
          return;
        }
      }

      const permission = msg.misc?.permission_info;
      if (permission?.permission === HostPermission.PrivacyMode || permission?.permission === HostPermission.Clipboard) {
        if (permission.permission === HostPermission.PrivacyMode) conn.privacyAllowed = permission.enabled === true;
        else conn.clipboardAllowed = permission.enabled === true;
        sendJson({ type: 'permissions', ...permissions(conn) });
      }
      const notice = msg.misc?.back_notification;
      if (typeof notice?.privacy_mode_state === 'number') {
        const code = notice.privacy_mode_state;
        if (code === PrivacyState.Enabled) state.privacyImpl = notice.impl_key || '';
        if (code === PrivacyState.Unsupported) {
          conn.privacyAllowed = false;
          sendJson({ type: 'permissions', ...permissions(conn) });
        }
        sendJson({ type: 'privacyResult', ...privacyResult(code) });
      }
      if (permission?.permission === HostPermission.Restart) {
        conn.restartAllowed = permission.enabled === true;
        sendJson({ type: 'restartPermission', allowed: canRestart(conn) });
      }
      if (permission?.permission === HostPermission.Audio) {
        state.audioAllowed = permission.enabled === true;
        if (!state.audioAllowed && state.audioRequested) {
          state.audioRequested = false;
          sendJson({ type: 'audioDenied' });
        }
      }
      if (msg.misc?.audio_format) {
        const { sample_rate: sampleRate, channels } = msg.misc.audio_format;
        state.audioFormat = typeof sampleRate === 'number' && typeof channels === 'number' ? { sampleRate, channels } : null;
        if (state.audioRequested && state.audioAllowed && state.audioFormat) sendJson({ type: 'audioFormat', ...state.audioFormat });
      }
      const packet = msg.audio_frame?.data;
      if (state.audioAllowed && state.audioRequested && packet && packet.length > 0 && packet.length <= 8192 && ws.bufferedAmount < AUDIO_QUEUE_LIMIT_BYTES) {
        if (state.audioBinary) sendBinary(encodeAudioFrame(packet));
        else sendJson({ type: 'audioFrame', packet: Buffer.from(packet).toString('base64') });
      }

      // 3. Clipboard (single or RustDesk 1.4/1.5 MultiClipboards, bounded UTF-8)
      if (conn.clipboardAllowed) {
        const clips = msg.clipboard ? [msg.clipboard] : msg.multi_clipboards?.clipboards ?? [];
        for (const clip of clips) {
          const text = decodeClipboard(clip);
          if (text !== null) {
            sendJson({ type: 'clipboard', text });
            break;
          }
        }
      }

      // 4. Cursor shape and position
      if (msg.cursor_data) {
        sendJson(cursorPublisher.update(msg.cursor_data));
      } else if (msg.cursor_id !== undefined) {
        sendJson(cursorPublisher.select(msg.cursor_id));
      } else if (msg.cursor_position) {
        sendJson({
          type: 'cursor',
          x: Number(msg.cursor_position.x ?? 0),
          y: Number(msg.cursor_position.y ?? 0),
        });
      }

      // 4b. Mid-session PeerInfo update (e.g. display hotplug or RustDesk 1.5 refreshed peer_info)
      if (msg.peer_info) {
        const updatedSize = initialDisplaySize(msg.peer_info);
        if (updatedSize.width > 0 && updatedSize.height > 0) {
          state.currentSize = updatedSize;
        }
        sendJson(peerToJson(msg.peer_info, conn));
        publishResolutions(Number(msg.peer_info.current_display ?? 0), msg.peer_info.resolutions);
      }

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
