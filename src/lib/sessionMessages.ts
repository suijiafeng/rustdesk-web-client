import { CursorImages } from './cursorImages';
import { asAppError, readErrorPayload, type ErrorPayload } from '../../shared/errors';
import type { Dispatch, RefObject, SetStateAction } from 'react';
import type { MobilePanel } from '../components/MobileSessionPanel';
import type { SessionStats } from './sessionStats';
import type { ConnectionMode, ConnectionPhase, ConnectRequest } from '../types';
import { upsertRecentDevice, type SavedDevice } from './devices';
import type { DisplayPrefs } from './displayPrefs';
import { computeDiagnosticsSummary, recordPongReceived, PING_TIMEOUT_MS, type DiagnosticsState, type DiagnosticsSummary } from './diagnostics';
import { t, type I18nKey, type Locale } from './i18n';
import type { ViewMode } from './mapping';
import type { ClientMessage, PeerMessage, ServerMessage } from './protocol';
import type { RemoteAudio } from './remoteAudio';

type Setter<T> = Dispatch<SetStateAction<T>>;

export interface SessionMessageConnection {
  activeMode: ConnectionMode;
  targetPeerId: string;
  targetIdServer: string;
  targetRelayServer: string;
  targetServerKey: string;
  targetForceRelay: boolean;
  targetHost: string;
  targetPortStr: string;
  targetPassword: string;
  shouldRemember: boolean;
  targetGatewayToken: string;
  targetDeviceKey: string;
  req: ConnectRequest | undefined;
}

export interface SessionMessageContext {
  locale: Locale;
  peerId: string;
  idServer: string;
  relayServer: string;
  serverKey: string;
  forceRelay: boolean;
  host: string;
  port: string;
  reconnectRequest: RefObject<ConnectRequest | null>;
  phaseRef: RefObject<ConnectionPhase>;
  sizeRef: RefObject<{ width: number; height: number }>;
  displayPrefsRef: RefObject<DisplayPrefs>;
  cursorElRef: RefObject<HTMLDivElement | null>;
  audioRef: RefObject<Pick<RemoteAudio, 'configure' | 'push'> | null>;
  diagStateRef: RefObject<DiagnosticsState>;
  setWebRtcFallbackReason: Setter<string | null>;
  setRestartState: Setter<'requested' | 'waiting' | null>;
  setGatewayTokenRejected: Setter<boolean>;
  setTemporaryGatewayToken: Setter<string | undefined>;
  setPhase: Setter<ConnectionPhase>;
  setConnectDialog: Setter<boolean>;
  setMenuOpen: Setter<boolean>;
  setAuthRequired: Setter<boolean>;
  setPeer: Setter<PeerMessage | null>;
  setDisplay: Setter<number>;
  setCursorEmbedded: Setter<boolean>;
  setStats: Setter<SessionStats>;
  setDevices: Setter<SavedDevice[]>;
  setPrivacyPending: Setter<boolean>;
  setPrivacyEnabled: Setter<boolean>;
  setDecoderError: Setter<string>;
  setMobilePanel: Setter<MobilePanel>;
  setViewMode: Setter<ViewMode>;
  setZoom: Setter<number>;
  setPan: Setter<{ panX: number; panY: number }>;
  setResolutionOptions: Setter<Extract<ServerMessage, { type: 'resolutions' }> | null>;
  setCursorShape: Setter<{ pixels: ImageData; hotX: number; hotY: number } | null>;
  setRtt: Setter<number>;
  setGatewayVideo: Setter<Extract<ServerMessage, { type: 'pong' }>['gatewayVideo']>;
  setDiagSummary: Setter<DiagnosticsSummary>;
  setStatusDetail: (key: I18nKey | null, customText?: string, error?: ErrorPayload) => void;
  rememberDevicePassword: (key: string, password: string) => void;
  handleClearSavedPassword: (key: string) => void;
  focusDesktopCapture: () => void;
  placeCursor: (x: number, y: number) => void;
  showSessionTip: (text: string, error?: boolean) => void;
  stopAudio: () => void;
  send: (message: ClientMessage) => void;
  clipboard: { receive: (text: string) => void };
  connection: SessionMessageConnection;
  onTerminalError: () => void;
}

type MessageHandlers = {
  [Type in ServerMessage['type']]: (message: Extract<ServerMessage, { type: Type }>) => void;
};

/** Create one dispatcher per socket; display and cursor origins belong to that session. */
export function createSessionMessageHandler(context: SessionMessageContext) {
  const {
    locale,
    peerId,
    idServer,
    relayServer,
    serverKey,
    forceRelay,
    host,
    port,
    reconnectRequest,
    phaseRef,
    sizeRef,
    displayPrefsRef,
    cursorElRef,
    audioRef,
    diagStateRef,
    setWebRtcFallbackReason,
    setRestartState,
    setGatewayTokenRejected,
    setTemporaryGatewayToken,
    setPhase,
    setConnectDialog,
    setMenuOpen,
    setAuthRequired,
    setPeer,
    setDisplay,
    setCursorEmbedded,
    setStats,
    setDevices,
    setPrivacyPending,
    setPrivacyEnabled,
    setDecoderError,
    setMobilePanel,
    setViewMode,
    setZoom,
    setPan,
    setResolutionOptions,
    setCursorShape,
    setRtt,
    setGatewayVideo,
    setDiagSummary,
    setStatusDetail,
    rememberDevicePassword,
    handleClearSavedPassword,
    focusDesktopCapture,
    placeCursor,
    showSessionTip,
    stopAudio,
    send,
    clipboard,
    onTerminalError,
  } = context;
  const {
    activeMode,
    targetPeerId,
    targetIdServer,
    targetRelayServer,
    targetServerKey,
    targetForceRelay,
    targetHost,
    targetPortStr,
    targetPassword,
    shouldRemember,
    targetGatewayToken,
    targetDeviceKey,
    req,
  } = context.connection;
  const cursorImages = new CursorImages(id => send({ type: 'cursorRequest', id }));
  let disposed = false;
  const dispose = () => { disposed = true; cursorImages.clear(); setCursorShape(null); };
  let sessionDisplays: PeerMessage['displays'] = [];
  let activeDisplay = 0;
  let cursorDisplayOrigin = { x: 0, y: 0 };

  const handlers: MessageHandlers = {
    hello() {},
    webrtcFallback(msg) {
      setWebRtcFallbackReason(msg.reason);
    },
    status(msg) {
      if (msg.state === 'live') {
        reconnectRequest.current = {
          mode: activeMode, peerId: targetPeerId, idServer: targetIdServer, relayServer: targetRelayServer,
          serverKey: targetServerKey, forceRelay: targetForceRelay, host: targetHost, port: targetPortStr,
          password: targetPassword, remember: shouldRemember, gatewayToken: targetGatewayToken,
        };
        setRestartState(null);
        setGatewayTokenRejected(false);
        if (req?.gatewayToken !== undefined) setTemporaryGatewayToken(targetGatewayToken);
        phaseRef.current = 'live';
        setPhase('live');
        setConnectDialog(false);
        setMenuOpen(false);
        setStatusDetail(
          msg.detail === 'encrypted' ? 'detailEncryptedSession' : 'linkPlain',
        );
        if (shouldRemember && targetPassword) {
          rememberDevicePassword(targetDeviceKey, targetPassword);
        } else if (!shouldRemember) {
          handleClearSavedPassword(targetDeviceKey);
        }
        focusDesktopCapture();
      } else if (msg.state === 'connecting') {
        phaseRef.current = 'connecting';
        setPhase('connecting');
        if (msg.detail) {
          setStatusDetail(null, msg.detail);
        } else {
          setStatusDetail('connecting');
        }
      } else if (msg.state === 'error') {
        const failure = readErrorPayload(msg) ?? asAppError(msg.detail);
        if (['PASSWORD_INVALID', 'PASSWORD_REQUIRED', 'GATEWAY_TOKEN_INVALID', 'TWO_FACTOR_REQUIRED'].includes(failure.code)) setRestartState(null);
        onTerminalError();
        phaseRef.current = 'error';
        setPhase('error');
        setConnectDialog(true);
        setMenuOpen(false);
        if (failure.code === 'PASSWORD_INVALID' || failure.code === 'PASSWORD_REQUIRED') {
          // Clear stale remembered password so the next attempt prompts cleanly
          handleClearSavedPassword(targetDeviceKey);
        }
        if (failure.code === 'GATEWAY_TOKEN_INVALID') {
          setAuthRequired(true);
          setGatewayTokenRejected(true);
          setStatusDetail('detailTokenError', '', failure);
        } else if (msg.detail || readErrorPayload(msg)) {
          setStatusDetail(null, failure.detail, failure);
        } else {
          setStatusDetail('detailHostRejected');
        }
      } else if (msg.state === 'closed') {
        phaseRef.current = 'idle';
        setPhase('idle');
        setStatusDetail('detailDisconnected');
      }
    },
    peer(msg) {
      sessionDisplays = msg.displays;
      activeDisplay = msg.currentDisplay;
      setPeer(msg);
      setDisplay(msg.currentDisplay);
      const chosen = msg.displays[msg.currentDisplay] ?? msg.displays[0];
      cursorDisplayOrigin = { x: chosen?.x ?? 0, y: chosen?.y ?? 0 };
      setCursorEmbedded(Boolean(chosen?.cursorEmbedded));
      if (chosen && chosen.width > 0 && chosen.height > 0) {
        sizeRef.current = { width: chosen.width, height: chosen.height };
        setStats((prev) => ({ ...prev, width: chosen.width, height: chosen.height }));
        placeCursor(chosen.width / 2, chosen.height / 2);
      }
      setDevices((prev) =>
        upsertRecentDevice(
          prev,
          activeMode === 'id'
            ? {
                mode: 'id',
                peerId: targetPeerId,
                idServer: targetIdServer,
                relayServer: targetRelayServer,
                serverKey: targetServerKey,
                forceRelay: targetForceRelay,
                hostname: msg.hostname || '',
                platform: msg.platform || '',
              }
            : {
                mode: 'direct',
                host: targetHost,
                port: targetPortStr,
                hostname: msg.hostname || '',
                platform: msg.platform || '',
              },
          Date.now(),
        ),
      );
    },
    permissions(msg) {
      setPeer(previous => previous ? { ...previous, privacyAllowed: msg.privacyAllowed, clipboardAllowed: msg.clipboardAllowed } : previous);
      if (!msg.privacyAllowed) setPrivacyPending(false);
    },
    privacyResult(msg) {
      showSessionTip(t(locale, msg.failed ? 'privacyFailed' : msg.enabled ? 'privacyOn' : 'privacyOff'), msg.failed);
      if (typeof msg.enabled === 'boolean') setPrivacyEnabled(msg.enabled);
      setPrivacyPending(false);
    },
    restartPermission(msg) {
      setPeer(previous => previous ? { ...previous, restartAllowed: msg.allowed } : previous);
    },
    restartResult(msg) {
      if (!msg.sent) {
        setRestartState(null);
        setDecoderError(t(locale, 'restartFailed'));
        setMobilePanel('actions');
        setMenuOpen(true);
      }
    },
    audioDenied() {
      stopAudio();
      showSessionTip(t(locale, 'audioDenied'), true);
    },
    audioFormat(msg) {
      audioRef.current?.configure(msg.sampleRate, msg.channels);
    },
    audioFrame(msg) {
      audioRef.current?.push(msg.packet);
    },
    focusedDisplay(msg) {
      if (displayPrefsRef.current.followWindow && msg.display !== activeDisplay &&
          sessionDisplays.some(d => d.index === msg.display && d.online !== false)) {
        send({ type: 'switchDisplay', display: msg.display });
      }
    },
    display(msg) {
      activeDisplay = msg.display;
      setDisplay(msg.display);
      cursorDisplayOrigin = { x: msg.x ?? 0, y: msg.y ?? 0 };
      setCursorEmbedded(Boolean(msg.cursorEmbedded));
      if (msg.width > 0 && msg.height > 0) {
        sizeRef.current = { width: msg.width, height: msg.height };
        setStats((prev) => ({ ...prev, width: msg.width, height: msg.height }));
        setViewMode('fit');
        setZoom(1);
        setPan({ panX: 0, panY: 0 });
      }
    },
    cursor(msg) {
      const x = msg.x - cursorDisplayOrigin.x;
      const y = msg.y - cursorDisplayOrigin.y;
      const { width, height } = sizeRef.current;
      if (x >= 0 && x < width && y >= 0 && y < height) {
        placeCursor(x, y);
      } else if (cursorElRef.current) {
        cursorElRef.current.style.visibility = 'hidden';
      }
    },
    resolutions(msg) {
      setResolutionOptions(msg);
    },
    cursorShape(msg) {
      setCursorShape(cursorImages.receive(msg));
    },
    cursorId(msg) {
      setCursorShape(cursorImages.select(msg.id));
    },
    clipboard(msg) {
      if (!displayPrefsRef.current.disableClipboard) {
        clipboard.receive(msg.text);
      }
    },
    rtt(msg) {
      setRtt(msg.ms);
    },
    delayProbe(msg) {
      send({ type: 'delayAck', id: msg.id });
    },
    pong(msg) {
      setGatewayVideo(msg.gatewayVideo);
      const now = performance.now();
      diagStateRef.current = recordPongReceived(diagStateRef.current, msg.seq, now);
      setDiagSummary(computeDiagnosticsSummary(diagStateRef.current, now, PING_TIMEOUT_MS));
    },
    error(msg) {
      setDecoderError(msg.message);
      const failure = readErrorPayload(msg) ?? asAppError(msg.message);
      setStatusDetail(null, msg.message, failure);
      if (phaseRef.current === 'connecting') {
        if (['PASSWORD_INVALID', 'PASSWORD_REQUIRED', 'GATEWAY_TOKEN_INVALID', 'TWO_FACTOR_REQUIRED'].includes(failure.code)) setRestartState(null);
        onTerminalError();
        phaseRef.current = 'error';
        setPhase('error');
        setConnectDialog(true);
      }
    },
  };

  const handle = (message: ServerMessage) => {
    if (disposed) return;
    // The discriminant selects the matching payload type from the exhaustive map.
    if (!Object.hasOwn(handlers, message.type)) return;
    const handler = handlers[message.type] as ((value: ServerMessage) => void) | undefined;
    handler?.(message);
    if (message.type === 'status' && (message.state === 'closed' || message.state === 'error')) dispose();
  };
  return Object.assign(handle, { dispose });
}
