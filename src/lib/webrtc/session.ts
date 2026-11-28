import { type PeerInfo, peerToJson, initialDisplaySize } from '../../../shared/peer.ts';
import { errorPayload } from '../../../shared/errors';
import { Buffer } from 'buffer';
import { type ClientMessage, type CodecCaps, buildRefreshVideoMessage, toHostMessage } from '../../../shared/control.ts';
import {
  buildQualityControlMessage,
  buildResolutionControlMessage,
  createSharedVideoPipeline,
  dispatchCommonHostMessage,
  handleAudioControl,
  publishResolutions,
  sendPrivacyControl,
  sendRestartControl,
  type HostSessionState,
} from '../../../shared/hostSession.ts';
import { decodeMessage, encodeMessage } from '../../../shared/protos.ts';
import { GatewayVideoBuffer } from '../../../shared/videoBuffer.ts';
import { CursorShapes, CursorPublisher } from '../../../shared/cursor.ts';
import type { DataChannelStream } from './stream';

const SEND_PRESSURE_BYTES = 64 * 1024;

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
  const videoBuffer = new GatewayVideoBuffer();
  const hostConn = conn;
  const hostState: HostSessionState = {
    resolutionDisplay: 0,
    sizes: [],
    sessionCodecs,
    preferredCodec,
    privacyImpl: '',
    audioRequested: false,
    audioAllowed: conn.audioAllowed !== false,
    audioFormat: null,
    currentSize: { width: 0, height: 0 },
  };
  const sendJson = (value: object) => { if (state === 'live') onData(JSON.stringify(value)); };
  const sendBinary = (value: Uint8Array) => { if (state === 'live') onData(new Uint8Array(value).buffer); };
  const fail = (error: unknown) => {
    sendJson({ type: 'status', state: 'error', ...errorPayload(error) });
    cleanup();
  };
  const video = createSharedVideoPipeline<NativeConnection>({
    state: hostState,
    videoBuffer,
    getQueuedBytes: () => conn.stream.queuedBytes,
    isLive: () => state === 'live',
    sendJson,
    sendBinary,
    onSendError: (_conn, error) => fail(error),
  });
  const cleanup = (_sendClosedStatus = false) => {
    if (state === 'closed') return;
    state = 'closed';
    video.dispose();
    cursorPublisher.clear();
    conn.stream.close();
    onClose();
  };
  const startHostPump = async (conn: NativeConnection) => {
    hostState.currentSize = initialDisplaySize(conn.peerInfo);
    sendJson(peerToJson(conn.peerInfo, conn));
    publishResolutions(hostState, Number(conn.peerInfo.current_display ?? 0), conn.peerInfo.resolutions, sendJson);
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

        // 2-4b. Misc control events, permissions, audio, clipboard, cursor, and PeerInfo
        const closed = dispatchCommonHostMessage(msg, conn, hostState, {
          sendJson,
          cursorPublisher,
          audioBinary: media?.audioBinary === true,
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
          video.handleFrame(conn, msg.video_frame);
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
      if (parsed.type === 'mouse' && parsed.action === 'move' && hostConn.stream.sendQueueBytes > SEND_PRESSURE_BYTES) {
        return;
      }
      if (parsed.type === 'clipboard' && (!hostConn.clipboardAllowed || typeof parsed.text !== 'string')) return;
      if (parsed.type === 'privacy') {
        await sendPrivacyControl(hostConn, hostState, parsed.enabled, sendJson);
        return;
      }
      if (parsed.type === 'restart') {
        await sendRestartControl(hostConn, sendJson);
        return;
      }
      if (parsed.type === 'audio') {
        if (!handleAudioControl(hostState, parsed.enabled, sendJson)) return;
      }
      let hostMsg;
      let refreshVideo = false;
      if (parsed.type === 'resolution') {
        hostMsg = buildResolutionControlMessage(hostConn, hostState, parsed.display, parsed.width, parsed.height, sendJson);
        if (!hostMsg) return;
      } else if (parsed.type === 'quality') {
        const built = buildQualityControlMessage(hostState, parsed, sendJson);
        if (!built) return;
        hostMsg = built.hostMsg;
        refreshVideo = built.refreshVideo;
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
