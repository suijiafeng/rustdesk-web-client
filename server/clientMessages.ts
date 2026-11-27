import { AppError, errorPayload } from '../shared/errors.ts';
import type { RawData } from 'ws';
import { authenticateGateway } from './auth.ts';
import {
  type ClientMessage,
  buildRefreshVideoMessage,
  hasAnyCodec,
  selectCodecs,
  toHostMessage,
} from '../shared/control.ts';
import {
  buildQualityControlMessage,
  buildResolutionControlMessage,
  handleAudioControl,
  sendPrivacyControl,
  sendRestartControl,
} from '../shared/hostSession.ts';
import { encodeMessage } from '../shared/protos.ts';
import type { HostMessage } from '../shared/protoTypes.ts';
import { SEND_PRESSURE_BYTES } from './bytesCodec.ts';
import { type ConnectedHost, connectDirect, connectViaId } from './rustdeskClient.ts';
import type { GatewayConfig, SessionContext } from './sessionState.ts';

interface ClientMessageContext extends SessionContext {
  config: GatewayConfig;
  connectionSignal: AbortSignal;
  clearConnectDeadline: () => void;
  startHostPump: (conn: ConnectedHost) => Promise<void>;
}

type MessageByType = {
  [Type in ClientMessage['type']]: Extract<ClientMessage, { type: Type }>;
};

type MessageHandlers = {
  [Type in keyof MessageByType]: (message: MessageByType[Type]) => void | Promise<void>;
};

export function createClientMessageHandler(context: ClientMessageContext) {
  const { state, ws, videoBuffer, sendJson, cleanup, config, connectionSignal, clearConnectDeadline, startHostPump } = context;

  const forwardToHost = (hostMsg: HostMessage | null, refreshVideo = false) => {
    const activeHost = state.hostConn;
    if (hostMsg && activeHost) {
      void activeHost.stream.sendRaw(encodeMessage(hostMsg)).catch((err) => {
        if (state.phase === 'live') {
          sendJson({ type: 'status', state: 'error', ...errorPayload(err) });
          cleanup(false);
        }
      });
      if (refreshVideo) {
        void activeHost.stream
          .sendRaw(encodeMessage(buildRefreshVideoMessage()))
          .catch(() => {});
      }
    }
  };

  const forwardControl = (parsed: ClientMessage) => {
    forwardToHost(toHostMessage(parsed, state.sessionCodecs));
  };

  const handlers: MessageHandlers = {
    ping: parsed => {
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
    },
    disconnect: () => {
      cleanup(true);
    },
    connect: async parsed => {
      if (state.phase !== 'awaiting-connect') {
        sendJson({ type: 'error', message: 'already connected' });
        return;
      }

      clearConnectDeadline();
      try {
        authenticateGateway(config.token, parsed.token, config.admission);
      } catch (error) {
        sendJson({ type: 'status', state: 'error', ...errorPayload(error) });
        cleanup(false);
        return;
      }

      const codecs = selectCodecs(parsed.codecs);
      if (!hasAnyCodec(codecs)) {
        sendJson({
          type: 'status',
          state: 'error',
          ...errorPayload(new AppError('CODEC_UNSUPPORTED', 'codec', 'This browser cannot decode VP8, VP9, H.264, HEVC, or AV1.')),
        });
        cleanup(false);
        return;
      }
      state.sessionCodecs = codecs;
      state.cursorIds = parsed.media?.cursorIds === true;
      state.audioBinary = parsed.media?.audioBinary === true;
      state.delayEcho = parsed.media?.delayEcho === true;

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
                  customQuality: parsed.customQuality,
                  lockAfterSessionEnd: parsed.lockAfterSessionEnd === true,
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
                  customQuality: parsed.customQuality,
                  lockAfterSessionEnd: parsed.lockAfterSessionEnd === true,
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
        state.audioAllowed = conn.audioAllowed;
        state.phase = 'live';
        void startHostPump(conn);
      } catch (err) {
        if ((state.phase as string) !== 'closed') {
          sendJson({ type: 'status', state: 'error', ...errorPayload(err) });
          cleanup(false);
        }
      }
    },
    clipboard: parsed => {
      const conn = state.hostConn;
      if (!conn || !conn.clipboardAllowed || typeof parsed.text !== 'string') return;
      forwardControl(parsed);
    },
    privacy: async parsed => {
      const conn = state.hostConn;
      if (!conn) return;
      await sendPrivacyControl(conn, state, parsed.enabled, sendJson);
    },
    restart: async () => {
      const conn = state.hostConn;
      if (!conn) return;
      await sendRestartControl(conn, sendJson);
    },
    audio: parsed => {
      if (!handleAudioControl(state, parsed.enabled, sendJson)) return;
      forwardControl(parsed);
    },
    resolution: parsed => {
      const conn = state.hostConn;
      if (!conn) return;
      const hostMsg = buildResolutionControlMessage(conn, state, parsed.display, parsed.width, parsed.height, sendJson);
      if (hostMsg) forwardToHost(hostMsg);
    },
    quality: parsed => {
      const built = buildQualityControlMessage(state, parsed, sendJson);
      if (built) forwardToHost(built.hostMsg, built.refreshVideo);
    },
    cursorRequest: parsed => {
      if (state.cursorIds && typeof parsed.id === 'string' && parsed.id.length <= 128) {
        const message = state.cursorPublisher?.select(parsed.id, true);
        if (message) sendJson(message);
      }
    },
    delayAck: parsed => {
      if (!state.delayEcho || typeof parsed.id !== 'number' || !Number.isSafeInteger(parsed.id) || parsed.id <= 0) return;
      const pending = state.pendingDelayProbes;
      const probe = pending?.get(parsed.id);
      if (!probe) return;
      pending!.delete(parsed.id);
      forwardToHost({ test_delay: probe });
    },
    mouse: parsed => {
      if (parsed.action === 'move' && state.hostConn && state.hostConn.stream.sendQueueBytes > SEND_PRESSURE_BYTES) {
        return;
      }
      forwardControl(parsed);
    },
    key: forwardControl,
    text: forwardControl,
    followWindow: forwardControl,
    lockAfterSessionEnd: forwardControl,
    switchDisplay: forwardControl,
    refresh: forwardControl,
  };

  const dispatch = <Type extends keyof MessageByType>(type: Type, message: MessageByType[Type]) => handlers[type](message);

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
      const failure = new AppError('INVALID_REQUEST', 'input', 'Invalid client message');
      sendJson({ type: 'error', message: failure.message, ...errorPayload(failure) });
      return;
    }

    if (parsed.type !== 'ping' && parsed.type !== 'disconnect' && parsed.type !== 'connect') {
      if (state.phase === 'awaiting-connect') {
        sendJson({ type: 'error', message: 'send a connect message first' });
        return;
      }
      if (state.phase !== 'live' || !state.hostConn) return;
    }

    // Runtime messages are untrusted; inherited property names are not message types.
    if (!Object.hasOwn(handlers, parsed.type)) return;
    return dispatch(parsed.type, parsed);
  };
}
