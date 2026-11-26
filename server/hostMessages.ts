import { decodeClipboard } from './clipboard.ts';
import { humanizeError } from './control.ts';
import { CursorShapes } from './cursor.ts';
import { decodeMessage, encodeMessage } from './protos.ts';
import type { ConnectedHost } from './rustdeskClient.ts';
import { canRestart, permissions, type SessionContext } from './sessionState.ts';
import type { VideoFrameHandler } from './videoFrames.ts';

function peerToJson(peer: Record<string, any>, conn: ConnectedHost): Record<string, unknown> {
  const displays = Array.isArray(peer.displays)
    ? peer.displays.map((d: any, index: number) => ({
        index,
        name: String(d.name ?? ''),
        x: Number(d.x ?? 0),
        y: Number(d.y ?? 0),
        width: Number(d.width ?? 0),
        height: Number(d.height ?? 0),
        online: Boolean(d.online ?? true),
        cursorEmbedded: Boolean(d.cursor_embedded),
      }))
    : [];

  const encoding = peer.encoding
    ? {
        vp8: Boolean(peer.encoding.vp8),
        h264: Boolean(peer.encoding.h264),
        h265: Boolean(peer.encoding.h265),
        av1: Boolean(peer.encoding.av1),
      }
    : null;

  return {
    type: 'peer',
    hostname: String(peer.hostname ?? ''),
    platform: String(peer.platform ?? ''),
    username: String(peer.username ?? ''),
    version: String(peer.version ?? ''),
    currentDisplay: Number(peer.current_display ?? 0),
    displays,
    encoding,
    encrypted: conn.encrypted,
    route: conn.route,
    ...permissions(conn),
    restartAllowed: canRestart(conn),
  };
}

function initialDisplaySize(peer: Record<string, any>): { width: number; height: number } {
  const displays = Array.isArray(peer.displays) ? peer.displays : [];
  const idx = Number(peer.current_display ?? 0);
  const chosen = displays[idx] ?? displays[0];
  if (!chosen) return { width: 0, height: 0 };
  return {
    width: Math.max(0, Number(chosen.width ?? 0)),
    height: Math.max(0, Number(chosen.height ?? 0)),
  };
}

export async function startHostPump(
  conn: ConnectedHost,
  context: SessionContext,
  handleVideoFrame: VideoFrameHandler['handleFrame'],
): Promise<void> {
  const { state, ws, sendJson, cleanup } = context;
  const publishResolutions = (display: number, supported?: { resolutions?: typeof state.sizes }) => {
    state.resolutionDisplay = display;
    state.sizes = (supported?.resolutions ?? []).filter(({ width, height }) =>
      Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0);
    sendJson({ type: 'resolutions', display, sizes: state.sizes });
  };
  const cursorShapes = new CursorShapes();
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
      if (msg.test_delay && !msg.test_delay.from_client) {
        void conn.stream.sendRaw(encodeMessage({ test_delay: msg.test_delay })).catch(() => {});
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
          sendJson({ type: 'status', state: 'error', detail: humanizeError(reason) });
          // Appendix B fix #8: actively close the stream on close_reason
          cleanup(false);
          return;
        }
      }

      const permission = msg.misc?.permission_info;
      if (permission?.permission === 8 || permission?.permission === 2) {
        if (permission.permission === 8) conn.privacyAllowed = permission.enabled === true;
        else conn.clipboardAllowed = permission.enabled === true;
        sendJson({ type: 'permissions', ...permissions(conn) });
      }
      const notice = msg.misc?.back_notification;
      if (typeof notice?.privacy_mode_state === 'number') {
        const code = notice.privacy_mode_state;
        if (code === 4) state.privacyImpl = notice.impl_key || '';
        if (code === 3) {
          conn.privacyAllowed = false;
          sendJson({ type: 'permissions', ...permissions(conn) });
        }
        const enabled = code === 4 ? true : [3,5,6,7,8,9,11].includes(code) ? false : undefined;
        sendJson({ type: 'privacyResult', enabled, failed: ![4,8,9].includes(code) });
      }
      if (permission?.permission === 5) {
        conn.restartAllowed = permission.enabled === true;
        sendJson({ type: 'restartPermission', allowed: canRestart(conn) });
      }
      if (permission?.permission === 3) {
        state.audioAllowed = permission.enabled === true;
        if (!state.audioAllowed && state.audioRequested) {
          state.audioRequested = false;
          sendJson({ type: 'audioDenied' });
        }
      }
      if (msg.misc?.audio_format) {
        const { sample_rate: sampleRate, channels } = msg.misc.audio_format;
        state.audioFormat = { sampleRate, channels };
        if (state.audioRequested && state.audioAllowed) sendJson({ type: 'audioFormat', ...state.audioFormat });
      }
      const packet = msg.audio_frame?.data;
      if (state.audioAllowed && state.audioRequested && packet?.length > 0 && packet.length <= 8192 && ws.bufferedAmount < 262144) {
        sendJson({ type: 'audioFrame', packet: Buffer.from(packet).toString('base64') });
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
        sendJson({ type: 'cursorShape', shape: cursorShapes.decode(msg.cursor_data) });
      } else if (msg.cursor_id !== undefined) {
        sendJson({ type: 'cursorShape', shape: cursorShapes.get(msg.cursor_id) });
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
      sendJson({ type: 'status', state: 'error', detail: humanizeError(err) });
      cleanup(false);
    }
  }
}
