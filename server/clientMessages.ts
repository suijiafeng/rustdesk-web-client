import type { RawData } from 'ws';
import { tokenMatches } from './auth.ts';
import {
  type ClientMessage,
  buildRefreshVideoMessage,
  decodingPreferenceChanged,
  hasAnyCodec,
  humanizeError,
  selectCodecs,
  toHostMessage,
} from './control.ts';
import { encodeMessage } from './protos.ts';
import { type ConnectedHost, connectDirect, connectViaId } from './rustdeskClient.ts';
import { canRestart, permissions, type GatewayConfig, type SessionContext } from './sessionState.ts';

interface ClientMessageContext extends SessionContext {
  config: GatewayConfig;
  connectionSignal: AbortSignal;
  clearConnectDeadline: () => void;
  startHostPump: (conn: ConnectedHost) => Promise<void>;
}

export function createClientMessageHandler(context: ClientMessageContext) {
  const { state, ws, videoBuffer, sendJson, cleanup, config, connectionSignal, clearConnectDeadline, startHostPump } = context;

  return async (rawData: RawData, isBinary: boolean): Promise<void> => {
    if (isBinary || state.phase === 'closed') return;
    let parsed: ClientMessage;
    try {
      const text = typeof rawData === 'string' ? rawData : rawData.toString('utf8');
      parsed = JSON.parse(text) as ClientMessage;
      if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
        throw new Error('missing type field');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      sendJson({ type: 'error', message: `bad message: ${msg}` });
      return;
    }

    if (parsed.type === 'ping') {
      const seq = Number.isFinite(Number(parsed.seq)) ? Number(parsed.seq) : 0;
      const clientTs = Number.isFinite(Number(parsed.clientTs)) ? Number(parsed.clientTs) : 0;
      sendJson({
        type: 'pong',
        seq,
        clientTs,
        serverTs: Date.now(),
        ...(state.phase === 'live' && {
          gatewayVideo: {
            queuedBytes: ws.bufferedAmount,
            droppedFrames: videoBuffer.droppedFrames,
            recovering: videoBuffer.recovering,
          },
        }),
      });
      return;
    }

    if (parsed.type === 'disconnect') {
      cleanup(true);
      return;
    }

    if (state.phase === 'awaiting-connect') {
      if (parsed.type !== 'connect') {
        sendJson({ type: 'error', message: 'send a connect message first' });
        return;
      }

      clearConnectDeadline();
      const canAuthenticate = config.admission?.canAuthenticate() ?? true;
      const givenToken = typeof parsed.token === 'string' ? parsed.token : '';
      if (!canAuthenticate || !tokenMatches(config.token, givenToken)) {
        if (canAuthenticate) config.admission?.recordTokenFailure();
        sendJson({
          type: 'status',
          state: 'error',
          detail: canAuthenticate
            ? 'The gateway access token is missing or incorrect.'
            : 'Too many failed attempts. Try again shortly.',
        });
        cleanup(false);
        return;
      }

      const codecs = selectCodecs(parsed.codecs);
      if (!hasAnyCodec(codecs)) {
        sendJson({
          type: 'status',
          state: 'error',
          detail: 'This browser cannot decode VP8, VP9, H.264, HEVC, or AV1.',
        });
        cleanup(false);
        return;
      }
      state.sessionCodecs = codecs;

      state.phase = 'connecting';
      sendJson({ type: 'status', state: 'connecting', detail: 'dialing the host' });

      try {
        const conn =
          parsed.mode === 'id'
            ? await connectViaId(
                {
                  peerId: parsed.peerId ?? '',
                  password: parsed.password ?? '',
                  idServer: parsed.idServer ?? '',
                  relayServer: parsed.relayServer ?? '',
                  key: parsed.key ?? '',
                  forceRelay: Boolean(parsed.forceRelay),
                  quality: parsed.quality,
                  fps: parsed.fps,
                  preferCodec: parsed.codec,
                },
                codecs,
                connectionSignal,
              )
            : await connectDirect(
                {
                  host: parsed.host ?? '',
                  port: Number(parsed.port ?? 0),
                  password: parsed.password ?? '',
                  quality: parsed.quality,
                  fps: parsed.fps,
                  preferCodec: parsed.codec,
                },
                codecs,
                connectionSignal,
              );

        if ((state.phase as string) !== 'connecting') {
          conn.stream.close();
          return;
        }
        state.preferredCodec = parsed.codec;
        state.hostConn = conn;
        state.phase = 'live';
        void startHostPump(conn);
      } catch (err) {
        if ((state.phase as string) !== 'closed') {
          sendJson({ type: 'status', state: 'error', detail: humanizeError(err) });
          cleanup(false);
        }
      }
      return;
    }

    if (parsed.type === 'connect') {
      sendJson({ type: 'error', message: 'already connected' });
      return;
    }

    if (state.phase !== 'live') return;

    if (state.hostConn) {
      if (parsed.type === 'clipboard' && (!state.hostConn.clipboardAllowed || typeof parsed.text !== 'string')) return;
      if (parsed.type === 'privacy') {
        if (!permissions(state.hostConn).privacyAllowed || typeof parsed.enabled !== 'boolean') {
          sendJson({ type: 'privacyResult', failed: true });
          return;
        }
        const [major, minor, patch] = String(state.hostConn.peerInfo.version).split('.').map(Number);
        const modern = major > 1 || (major === 1 && (minor > 2 || (minor === 2 && patch >= 4)));
        const misc = modern ? { toggle_privacy_mode: { on: parsed.enabled, impl_key: state.privacyImpl } }
          : { option: { privacy_mode: parsed.enabled ? 2 : 1 } };
        try {
          await state.hostConn.stream.sendRaw(encodeMessage({ misc }));
        } catch {
          sendJson({ type: 'privacyResult', failed: true });
        }
        return;
      }
      if (parsed.type === 'restart') {
        const conn = state.hostConn;
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
        if (parsed.enabled && !state.audioAllowed) {
          sendJson({ type: 'audioDenied' });
          return;
        }
        state.audioRequested = parsed.enabled;
        if (state.audioRequested && state.audioFormat) sendJson({ type: 'audioFormat', ...state.audioFormat });
      }
      let hostMsg;
      let refreshVideo = false;
      if (parsed.type === 'resolution') {
        const { display, width, height } = parsed;
        if (display !== state.resolutionDisplay || !state.sizes.some(size => size.width === width && size.height === height)) {
          sendJson({ type: 'error', message: 'The active display does not offer that resolution.' });
          return;
        }
        const [major, minor, patch] = String(state.hostConn.peerInfo.version ?? '').split('.').map(Number);
        const modern = major > 1 || (major === 1 && (minor > 2 || (minor === 2 && patch >= 4)));
        const resolution = { width, height };
        hostMsg = { misc: modern
          ? { change_display_resolution: { display, resolution } }
          : { change_resolution: resolution } };
      } else if (parsed.type === 'quality') {
        refreshVideo = Boolean(state.sessionCodecs && decodingPreferenceChanged(state.sessionCodecs, state.preferredCodec, parsed.codec));
        if (refreshVideo) state.preferredCodec = parsed.codec;
        hostMsg = toHostMessage(refreshVideo ? parsed : { ...parsed, codec: undefined }, state.sessionCodecs);
      } else {
        hostMsg = toHostMessage(parsed, state.sessionCodecs);
      }
      if (hostMsg) {
        const activeHost = state.hostConn;
        void activeHost.stream.sendRaw(encodeMessage(hostMsg)).catch((err) => {
          if (state.phase === 'live') {
            sendJson({ type: 'status', state: 'error', detail: humanizeError(err) });
            cleanup(false);
          }
        });
        if (refreshVideo) {
          void activeHost.stream
            .sendRaw(encodeMessage(buildRefreshVideoMessage()))
            .catch(() => {});
        }
      }
    }
  };
}
