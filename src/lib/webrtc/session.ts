import { encodeAudioFrame } from '../../../shared/audio.ts';
import { type PeerInfo, canRestart, permissions, peerToJson, initialDisplaySize, HostPermission, PrivacyState, privacyResult, supportsModernDisplayControls, supportedResolutions } from '../../../shared/peer.ts';
import { errorPayload } from '../../../shared/errors';
import { decodeClipboard } from '../../../shared/clipboard.ts';
import { Buffer } from 'buffer';
import { type ClientMessage, type CodecCaps, buildRefreshVideoMessage, buildVideoReceivedMessage, decodingPreferenceChanged, humanizeError, toHostMessage } from '../../../shared/control.ts';
import { decodeMessage, encodeMessage } from '../../../shared/protos.ts';
import { CODEC_VP8, encodeRdv1Frame, vp8KeyframeSize, encodedFrameIsKey, extractEncodedFrames } from '../../../shared/video.ts';
import { CursorShapes, CursorPublisher } from '../../../shared/cursor.ts';
import type { DataChannelStream } from './stream';

export interface NativeConnection {
  stream: DataChannelStream;
  route: 'webrtc-direct' | 'webrtc-relay' | 'webrtc';
  encrypted: boolean;
  peerInfo: PeerInfo;
  username: string;
  privacyAllowed: boolean;
  clipboardAllowed: boolean;
  restartAllowed: boolean;
  audioAllowed?: boolean;
}

// Keep the gateway's session path unchanged. This adapter emits the same UI messages locally.
export function createNativeSession(
  conn: NativeConnection, sessionCodecs: CodecCaps,
  onData: (data: string | ArrayBuffer) => void, onClose: () => void,
  preferredCodec?: string,
  media?: { cursorIds?: boolean; audioBinary?: boolean },
) {
  let state: 'live' | 'closed' = 'live';
  const cursorPublisher = new CursorPublisher(new CursorShapes(), media?.cursorIds === true);
  const hostConn = conn;
  let resolutionDisplay = 0;
  let sizes: { width: number; height: number }[] = [];
  let privacyImpl = '';
  let audioRequested = false;
  let audioAllowed = conn.audioAllowed !== false;
  let audioFormat: { sampleRate: number; channels: number } | null = null;
  let warnedRawVideo = false;
  let currentSize = { width: 0, height: 0 };
  const sendJson = (value: object) => { if (state === 'live') onData(JSON.stringify(value)); };
  const sendBinary = (value: Uint8Array) => { if (state === 'live') onData(new Uint8Array(value).buffer); };
  const cleanup = (_sendClosedStatus = false) => {
    if (state === 'closed') return;
    state = 'closed';
    cursorPublisher.clear();
    conn.stream.close();
    onClose();
  };
  const fail = (error: unknown) => {
    sendJson({ type: 'status', state: 'error', ...errorPayload(error) });
    cleanup();
  };
  const startHostPump = async (conn: NativeConnection) => {
    const publishResolutions = (display: number, supported?: PeerInfo['resolutions']) => {
      resolutionDisplay = display;
      sizes = supportedResolutions(supported);
      sendJson({ type: 'resolutions', display, sizes });
    };
    currentSize = initialDisplaySize(conn.peerInfo);
    sendJson(peerToJson(conn.peerInfo, conn));
    publishResolutions(Number(conn.peerInfo.current_display ?? 0), conn.peerInfo.resolutions);
    sendJson({
      type: 'status',
      state: 'live',
      detail: conn.encrypted ? 'encrypted' : 'direct',
      username: conn.username,
    });

    try {
      while (state === 'live') {
        const raw = await conn.stream.next();
        if (!raw) {
          if (state === 'live') {
            throw new Error('host closed the connection');
          }
          break;
        }
        const msg = decodeMessage(raw);

        if (msg.test_delay?.from_client) {
          sendJson({ type: 'pong', seq: Number(msg.test_delay.time), clientTs: 0, serverTs: Date.now() });
        }
        // 1. TestDelay echo + RTT reporting
        if (msg.test_delay && !msg.test_delay.from_client) {
          void conn.stream.sendRaw(encodeMessage({ test_delay: msg.test_delay })).catch(fail);
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
              currentSize = { width: w, height: h };
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
          if (code === PrivacyState.Enabled) privacyImpl = notice.impl_key || '';
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
          audioAllowed = permission.enabled === true;
          if (!audioAllowed && audioRequested) {
            audioRequested = false;
            sendJson({ type: 'audioDenied' });
          }
        }
        if (msg.misc?.audio_format) {
          const { sample_rate: sampleRate, channels } = msg.misc.audio_format;
          audioFormat = typeof sampleRate === 'number' && typeof channels === 'number' ? { sampleRate, channels } : null;
          if (audioRequested && audioAllowed && audioFormat) sendJson({ type: 'audioFormat', ...audioFormat });
        }
        const packet = msg.audio_frame?.data;
        if (audioAllowed && audioRequested && packet && packet.length > 0 && packet.length <= 8192) {
          if (media?.audioBinary === true) sendBinary(encodeAudioFrame(packet));
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
            currentSize = updatedSize;
          }
          sendJson(peerToJson(msg.peer_info, conn));
          publishResolutions(Number(msg.peer_info.current_display ?? 0), msg.peer_info.resolutions);
        }

        // 5. VideoFrame
        if (msg.video_frame) {
          const vf = msg.video_frame;
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
                  currentSize = parsedSize;
                }
              }
              const pts = BigInt(f.pts ?? 0);
              const packet = encodeRdv1Frame({
                codec: extracted.codec,
                key: isKey,
                display,
                width: currentSize.width,
                height: currentSize.height,
                pts,
                gatewayUnixMs: nowMs,
                data: payload,
              });
              sendBinary(packet);
            }
            // RustDesk 1.5 QoS ACK once per message containing video frames (non-blocking)
            void conn.stream
              .sendRaw(encodeMessage(buildVideoReceivedMessage()))
              .catch(fail);
          }
        }
      }
    } catch (err) {
      if (state === 'live') {
        sendJson({ type: 'status', state: 'error', ...errorPayload(err) });
        cleanup(false);
      }
    }
  };

  const sendControl = async (parsed: ClientMessage) => {
    if (parsed.type === 'ping') {
      await conn.stream.sendRaw(encodeMessage({ test_delay: { time: parsed.seq, from_client: true } }));
      return;
    }
    if (parsed.type === 'cursorRequest') {
      if (media?.cursorIds === true && typeof parsed.id === 'string' && parsed.id.length <= 128) sendJson(cursorPublisher.select(parsed.id, true));
      return;
    }
    if (parsed.type === 'disconnect') { cleanup(); return; }
    if (hostConn) {
      if (parsed.type === 'clipboard' && (!hostConn.clipboardAllowed || typeof parsed.text !== 'string')) return;
      if (parsed.type === 'privacy') {
        if (!permissions(hostConn).privacyAllowed || typeof parsed.enabled !== 'boolean') {
          sendJson({ type: 'privacyResult', failed: true });
          return;
        }
        const modern = supportsModernDisplayControls(hostConn.peerInfo.version);
        const misc = modern ? { toggle_privacy_mode: { on: parsed.enabled, impl_key: privacyImpl } }
          : { option: { privacy_mode: parsed.enabled ? 2 : 1 } };
        try {
          await hostConn.stream.sendRaw(encodeMessage({ misc }));
        } catch {
          sendJson({ type: 'privacyResult', failed: true });
        }
        return;
      }
      if (parsed.type === 'restart') {
        const conn = hostConn;
        if (!canRestart(conn)) {
          sendJson({ type: 'restartResult', sent: false });
          return;
        }
        try {
          await conn.stream.sendRaw(encodeMessage({ misc: { restart_remote_device: true } }));
          sendJson({ type: 'restartResult', sent: true });
        } catch {
          sendJson({ type: 'restartResult', sent: false });
        }
        return;
      }
      if (parsed.type === 'audio') {
        if (typeof parsed.enabled !== 'boolean') return;
        if (parsed.enabled && !audioAllowed) {
          sendJson({ type: 'audioDenied' });
          return;
        }
        audioRequested = parsed.enabled;
        if (audioRequested && audioFormat) sendJson({ type: 'audioFormat', ...audioFormat });
      }
      let hostMsg;
      let refreshVideo = false;
      if (parsed.type === 'resolution') {
        const { display, width, height } = parsed;
        if (display !== resolutionDisplay || !sizes.some(size => size.width === width && size.height === height)) {
          sendJson({ type: 'error', message: 'The active display does not offer that resolution.' });
          return;
        }
        const modern = supportsModernDisplayControls(hostConn.peerInfo.version ?? '');
        const resolution = { width, height };
        hostMsg = { misc: modern
          ? { change_display_resolution: { display, resolution } }
          : { change_resolution: resolution } };
      } else if (parsed.type === 'quality') {
        try {
          refreshVideo = Boolean(sessionCodecs && decodingPreferenceChanged(sessionCodecs, preferredCodec, parsed.codec));
          hostMsg = toHostMessage(refreshVideo ? parsed : { ...parsed, codec: undefined }, sessionCodecs);
          if (refreshVideo) preferredCodec = parsed.codec;
        } catch (error) {
          sendJson({ type: 'error', message: humanizeError(error), ...errorPayload(error) });
          return;
        }
      } else {
        hostMsg = toHostMessage(parsed, sessionCodecs);
      }
      if (hostMsg) {
        const activeHost = hostConn;
        void activeHost.stream.sendRaw(encodeMessage(hostMsg)).catch((err) => {
          if (state === 'live') {
            sendJson({ type: 'status', state: 'error', ...errorPayload(err) });
            cleanup(false);
          }
        });
        if (refreshVideo) {
          void activeHost.stream
            .sendRaw(encodeMessage(buildRefreshVideoMessage()))
            .catch(fail);
        }
      }
    }

  };
  return {
    start: () => { void startHostPump(conn); },
    send: (message: ClientMessage) => { if (state === 'live') void sendControl(message).catch(fail); },
    close: cleanup,
  };
}
