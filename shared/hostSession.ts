import { encodeAudioFrame } from './audio.ts';
import { decodeClipboard } from './clipboard.ts';
import {
  buildRefreshVideoMessage,
  buildVideoReceivedMessage,
  decodingPreferenceChanged,
  humanizeError,
  toHostMessage,
  type CodecCaps,
} from './control.ts';
import type { CursorPublisher } from './cursor.ts';
import { errorPayload } from './errors.ts';
import {
  canRestart,
  HostPermission,
  initialDisplaySize,
  peerToJson,
  permissions,
  PrivacyState,
  privacyResult,
  supportedResolutions,
  supportsModernDisplayControls,
  type PeerInfo,
  type SessionPeer,
} from './peer.ts';
import { encodeMessage } from './protos.ts';
import type { HostMessage } from './protoTypes.ts';
import {
  CODEC_VP8,
  encodedFrameIsKey,
  encodeRdv1Frame,
  extractEncodedFrames,
  HEADER_LEN,
  vp8KeyframeSize,
  type EncodedVideo,
} from './video.ts';
import { VIDEO_RESUME_BYTES, type GatewayVideoBuffer } from './videoBuffer.ts';

const EMPTY_FRAME_DATA = new Uint8Array(0);

export interface HostSessionState {
  resolutionDisplay: number;
  sizes: { width: number; height: number }[];
  sessionCodecs: CodecCaps | undefined;
  preferredCodec: string | undefined;
  privacyImpl: string;
  audioRequested: boolean;
  audioAllowed: boolean;
  audioFormat: { sampleRate: number; channels: number } | null;
  currentSize: { width: number; height: number };
}

export interface HostSessionConnection extends SessionPeer {
  audioAllowed?: boolean;
  stream: {
    sendRaw: (raw: Uint8Array) => Promise<unknown>;
    sendQueueBytes: number;
  };
}

export interface HostMessageHandlers {
  sendJson: (payload: Record<string, unknown>) => void;
  cursorPublisher: CursorPublisher;
  onAudioFrame: (packet: Uint8Array) => void;
  onAudioBase64?: (packet: Uint8Array) => void;
  canSendAudio?: () => boolean;
  onCloseReason: (reason: string) => void;
  audioBinary?: boolean;
}

export function publishResolutions(
  state: Pick<HostSessionState, 'resolutionDisplay' | 'sizes'>,
  display: number,
  supported: PeerInfo['resolutions'] | undefined,
  sendJson: (payload: Record<string, unknown>) => void,
): void {
  state.resolutionDisplay = display;
  state.sizes = supportedResolutions(supported);
  sendJson({ type: 'resolutions', display, sizes: state.sizes });
}

/**
 * Handles host-to-client protocol messages shared between the gateway pump and
 * direct WebRTC sessions (misc controls, permissions, privacy, audio, clipboard,
 * cursor, and mid-session peer_info updates).
 *
 * Returns `true` if `close_reason` terminated the session.
 */
export function dispatchCommonHostMessage(
  msg: HostMessage,
  conn: HostSessionConnection,
  state: HostSessionState,
  handlers: HostMessageHandlers,
): boolean {
  const { sendJson, cursorPublisher, onAudioFrame, onAudioBase64, canSendAudio, onCloseReason } = handlers;
  const audioBinary = handlers.audioBinary ?? true;

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
      const displayIdx = Number(sd.display ?? 0);
      sendJson({
        type: 'display',
        display: displayIdx,
        width: w,
        height: h,
        x: Number(sd.x ?? 0),
        y: Number(sd.y ?? 0),
        cursorEmbedded: Boolean(sd.cursor_embedded),
        name: '',
      });
      publishResolutions(state, displayIdx, sd.resolutions, sendJson);
    }
    if (msg.misc.close_reason) {
      onCloseReason(String(msg.misc.close_reason));
      return true;
    }
    const permission = msg.misc.permission_info;
    if (permission?.permission === HostPermission.PrivacyMode || permission?.permission === HostPermission.Clipboard) {
      if (permission.permission === HostPermission.PrivacyMode) conn.privacyAllowed = permission.enabled === true;
      else conn.clipboardAllowed = permission.enabled === true;
      sendJson({ type: 'permissions', ...permissions(conn) });
    }
    const notice = msg.misc.back_notification;
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
      conn.audioAllowed = state.audioAllowed;
      if (!state.audioAllowed && state.audioRequested) {
        state.audioRequested = false;
        sendJson({ type: 'audioDenied' });
      }
    }
    if (msg.misc.audio_format) {
      const { sample_rate: sampleRate, channels } = msg.misc.audio_format;
      state.audioFormat = typeof sampleRate === 'number' && typeof channels === 'number' ? { sampleRate, channels } : null;
      if (state.audioRequested && state.audioAllowed && state.audioFormat) {
        sendJson({ type: 'audioFormat', ...state.audioFormat });
      }
    }
  }

  const packet = msg.audio_frame?.data;
  if (
    state.audioAllowed &&
    state.audioRequested &&
    packet &&
    packet.length > 0 &&
    packet.length <= 8192 &&
    (!canSendAudio || canSendAudio())
  ) {
    if (audioBinary) {
      onAudioFrame(encodeAudioFrame(packet));
    } else if (onAudioBase64) {
      onAudioBase64(packet);
    }
  }

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

  if (msg.cursor_data) {
    sendJson(cursorPublisher.update({
      ...msg.cursor_data,
      id: msg.cursor_data.id !== undefined ? String(msg.cursor_data.id) : undefined,
    }));
  } else if (msg.cursor_id !== undefined) {
    sendJson(cursorPublisher.select(String(msg.cursor_id)));
  } else if (msg.cursor_position) {
    sendJson({
      type: 'cursor',
      x: Number(msg.cursor_position.x ?? 0),
      y: Number(msg.cursor_position.y ?? 0),
    });
  }

  if (msg.peer_info) {
    const updatedSize = initialDisplaySize(msg.peer_info);
    if (updatedSize.width > 0 && updatedSize.height > 0) {
      state.currentSize = updatedSize;
    }
    sendJson(peerToJson(msg.peer_info, conn));
    publishResolutions(state, Number(msg.peer_info.current_display ?? 0), msg.peer_info.resolutions, sendJson);
  }

  return false;
}

export async function sendPrivacyControl(
  conn: HostSessionConnection,
  state: Pick<HostSessionState, 'privacyImpl'>,
  enabled: unknown,
  sendJson: (payload: Record<string, unknown>) => void,
): Promise<void> {
  if (!permissions(conn).privacyAllowed || typeof enabled !== 'boolean') {
    sendJson({ type: 'privacyResult', failed: true });
    return;
  }
  const modern = supportsModernDisplayControls(conn.peerInfo.version);
  const misc = modern
    ? { toggle_privacy_mode: { on: enabled, impl_key: state.privacyImpl } }
    : { option: { privacy_mode: enabled ? 2 : 1 } };
  try {
    await conn.stream.sendRaw(encodeMessage({ misc }));
  } catch {
    sendJson({ type: 'privacyResult', failed: true });
  }
}

export async function sendRestartControl(
  conn: HostSessionConnection,
  sendJson: (payload: Record<string, unknown>) => void,
): Promise<void> {
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
}

export function handleAudioControl(
  state: Pick<HostSessionState, 'audioAllowed' | 'audioRequested' | 'audioFormat'>,
  enabled: unknown,
  sendJson: (payload: Record<string, unknown>) => void,
): boolean {
  if (typeof enabled !== 'boolean') return false;
  if (enabled && !state.audioAllowed) {
    sendJson({ type: 'audioDenied' });
    return false;
  }
  state.audioRequested = enabled;
  if (state.audioRequested && state.audioFormat) {
    sendJson({ type: 'audioFormat', ...state.audioFormat });
  }
  return true;
}

export function buildResolutionControlMessage(
  conn: HostSessionConnection,
  state: Pick<HostSessionState, 'resolutionDisplay' | 'sizes'>,
  display: number,
  width: number,
  height: number,
  sendJson: (payload: Record<string, unknown>) => void,
): Record<string, unknown> | null {
  if (display !== state.resolutionDisplay || !state.sizes.some(size => size.width === width && size.height === height)) {
    sendJson({ type: 'error', message: 'The active display does not offer that resolution.' });
    return null;
  }
  const modern = supportsModernDisplayControls(conn.peerInfo.version ?? '');
  const resolution = { width, height };
  return {
    misc: modern
      ? { change_display_resolution: { display, resolution } }
      : { change_resolution: resolution },
  };
}

export function buildQualityControlMessage(
  state: Pick<HostSessionState, 'sessionCodecs' | 'preferredCodec'>,
  parsed: Parameters<typeof toHostMessage>[0] & { type: 'quality'; codec?: string },
  sendJson: (payload: Record<string, unknown>) => void,
): { hostMsg: Record<string, unknown>; refreshVideo: boolean } | null {
  try {
    const refreshVideo = Boolean(
      state.sessionCodecs && decodingPreferenceChanged(state.sessionCodecs, state.preferredCodec, parsed.codec),
    );
    const hostMsg = toHostMessage(refreshVideo ? parsed : { ...parsed, codec: undefined }, state.sessionCodecs);
    if (!hostMsg) return null;
    if (refreshVideo) state.preferredCodec = parsed.codec;
    return { hostMsg, refreshVideo };
  } catch (error) {
    sendJson({ type: 'error', message: humanizeError(error), ...errorPayload(error) });
    return null;
  }
}

export interface SharedVideoPipelineOptions<TConn extends Pick<HostSessionConnection, 'stream'>> {
  state: Pick<HostSessionState, 'currentSize'>;
  videoBuffer: GatewayVideoBuffer;
  getQueuedBytes: () => number;
  isLive: (conn: TConn) => boolean;
  sendJson: (payload: Record<string, unknown>) => void;
  sendBinary: (packet: Uint8Array) => void;
  onSendError: (conn: TConn, err: unknown) => void;
  ignoreAckErrors?: boolean;
}

export interface SharedVideoPipeline<TConn extends Pick<HostSessionConnection, 'stream'>> {
  handleFrame: (conn: TConn, vf: EncodedVideo) => void;
  dispose: () => void;
}

/**
 * Shared video frame extraction, RDV1 framing, congestion shedding, keyframe recovery timer,
 * and RustDesk 1.5 QoS `video_received` ACK logic used by both the Node.js gateway and WebRTC sessions.
 */
export function createSharedVideoPipeline<TConn extends Pick<HostSessionConnection, 'stream'>>(
  options: SharedVideoPipelineOptions<TConn>,
): SharedVideoPipeline<TConn> {
  const { state, videoBuffer, getQueuedBytes, isLive, sendJson, sendBinary, onSendError, ignoreAckErrors = false } = options;
  let recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  let warnedRawVideo = false;

  const scheduleVideoRecovery = (conn: TConn) => {
    if (recoveryTimer || !videoBuffer.needsRefresh) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = undefined;
      if (!isLive(conn) || !videoBuffer.needsRefresh) return;
      if (videoBuffer.shouldRequestRefresh(getQueuedBytes(), performance.now())) {
        void conn.stream.sendRaw(encodeMessage(buildRefreshVideoMessage())).catch((err) => {
          onSendError(conn, err);
        });
      }
      scheduleVideoRecovery(conn);
    }, 250);
    recoveryTimer.unref?.();
  };

  const handleFrame = (conn: TConn, vf: EncodedVideo) => {
    if ((vf.rgb || vf.yuv) && !warnedRawVideo) {
      warnedRawVideo = true;
      sendJson({
        type: 'error',
        message:
          'the host sent uncompressed video; this client only decodes vp8, vp9, h264, h265, and av1',
      });
    }

    const extracted = extractEncodedFrames(vf);
    if (!extracted) return;

    const display = Math.max(0, Number(vf.display ?? 0));
    const nowMs = BigInt(Date.now());
    const queuedBefore = getQueuedBytes();
    let forwarded = 0;

    for (const f of extracted.frames) {
      const payload = f.data ?? EMPTY_FRAME_DATA;
      const isKey = encodedFrameIsKey(extracted.codec, payload, f.key);
      if (extracted.codec === CODEC_VP8 && isKey) {
        const parsedSize = vp8KeyframeSize(payload);
        if (parsedSize) {
          state.currentSize = parsedSize;
        }
      }
      if (!videoBuffer.shouldForward(display, isKey, payload.byteLength + HEADER_LEN, getQueuedBytes())) {
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
      forwarded++;
    }

    // RustDesk 1.5 QoS ACK once per message containing video frames (non-blocking).
    // Suppress ACKs when frames were shed or the downlink is already backed up.
    if (forwarded > 0 && !videoBuffer.recovering && queuedBefore <= VIDEO_RESUME_BYTES) {
      void conn.stream
        .sendRaw(encodeMessage(buildVideoReceivedMessage()))
        .catch((err) => {
          if (!ignoreAckErrors) onSendError(conn, err);
        });
    }
  };

  return {
    handleFrame,
    dispose: () => {
      clearTimeout(recoveryTimer);
      recoveryTimer = undefined;
    },
  };
}
