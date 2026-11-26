import { useCallback, useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { SessionStats } from '../components/SessionMenu';
import type { ConnectionMode, ConnectionPhase, ConnectRequest } from '../types';
import { probeCodecs, webCodecsStatus, type RemoteDecoder } from '../lib/decoder';
import { deviceKeyFor } from '../lib/devices';
import { filterCodecSupport } from '../lib/displayPrefs';
import { t } from '../lib/i18n';
import { decodeFrame, wsUrl, type PeerMessage, type QualityLevel, type ServerMessage } from '../lib/protocol';
import { RemoteSocket } from '../lib/remoteSocket';
import { createSessionMessageHandler, type SessionMessageContext } from '../lib/sessionMessages';
import { createFrameStats, type FrameStatsState } from '../lib/stats';

interface GatewaySessionContext extends Omit<SessionMessageContext, 'connection' | 'onTerminalError'> {
  mode: ConnectionMode;
  password: string;
  gatewayToken: string;
  webRtcEnabled: boolean;
  webRtcOptIn: boolean;
  setWebRtcEnabled: Dispatch<SetStateAction<boolean>>;
  phase: ConnectionPhase;
  peer: PeerMessage | null;
  restartState: 'requested' | 'waiting' | null;
  restartDeadline: RefObject<number>;
  connectGeneration: RefObject<number>;
  wsRef: RefObject<WebSocket | RemoteSocket | null>;
  decoderRef: RefObject<RemoteDecoder | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  frameStatsRef: RefObject<FrameStatsState>;
  statAccRef: RefObject<{ width: number; height: number; decoded: number; dropped: number; lastDelayMs: number; lastCodec: string }>;
  lastInputPointRef: RefObject<{ x: number; y: number } | null>;
  emptyStats: SessionStats;
  setQuality: Dispatch<SetStateAction<QualityLevel>>;
  setTargetFps: Dispatch<SetStateAction<number>>;
  setSoftKeys: Dispatch<SetStateAction<boolean>>;
  setToolbarExpanded: Dispatch<SetStateAction<boolean>>;
  ensureDecoder: () => RemoteDecoder;
  noteFrame: (codec: string, width: number, height: number, bytes: number, delayMs: number) => void;
  resetDiagnostics: () => void;
  finishPendingClick: () => void;
  clearLongPress: () => void;
}

export function useGatewaySession(context: GatewaySessionContext) {
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
    setWebRtcFallbackReason,
    setRestartState,
    setPhase,
    setConnectDialog,
    setMenuOpen,
    setAuthRequired,
    setPeer,
    setCursorEmbedded,
    setStats,
    setPrivacyPending,
    setPrivacyEnabled,
    setDecoderError,
    setMobilePanel,
    setResolutionOptions,
    setCursorShape,
    setRtt,
    setGatewayVideo,
    setStatusDetail,
    rememberDevicePassword,
    handleClearSavedPassword,
    placeCursor,
    send,
    mode,
    password,
    gatewayToken,
    webRtcEnabled,
    webRtcOptIn,
    setWebRtcEnabled,
    phase,
    peer,
    restartState,
    restartDeadline,
    connectGeneration,
    wsRef,
    decoderRef,
    canvasRef,
    frameStatsRef,
    statAccRef,
    lastInputPointRef,
    setQuality,
    setTargetFps,
    setSoftKeys,
    setToolbarExpanded,
    ensureDecoder,
    noteFrame,
    resetDiagnostics,
    finishPendingClick,
    clearLongPress,
    emptyStats: EMPTY_STATS,
  } = context;

  const messageDisposer = useRef<(() => void) | null>(null);
  const clearSessionMessages = useCallback(() => {
    messageDisposer.current?.();
    messageDisposer.current = null;
  }, []);
  useEffect(() => clearSessionMessages, [clearSessionMessages]);

  // Fetch /api/health on mount
  useEffect(() => {
    let active = true;
    fetch('/api/health', { cache: 'no-store' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active) setWebRtcEnabled(data?.webRtcEnabled === true);
        if (active && data && typeof data.authRequired === 'boolean') {
          setAuthRequired(data.authRequired);
        }
      })
      .catch(() => {
        if (active) setAuthRequired(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const connectSession = useCallback(
    async (req?: ConnectRequest, retry = false) => {
      const generation = ++connectGeneration.current;
      setWebRtcFallbackReason(null);
      if (!retry) {
        setRestartState(null);
        reconnectRequest.current = null;
      }
      const activeMode = req?.mode ?? mode;
      const targetPeerId = (req?.peerId ?? peerId).replace(/\s+/g, '');
      const targetIdServer = (req?.idServer ?? idServer).trim();
      const targetRelayServer = (req?.relayServer ?? relayServer).trim();
      const targetServerKey = (req?.serverKey ?? serverKey).trim();
      const targetForceRelay = req?.forceRelay ?? forceRelay;
      const targetHost = (req?.host ?? host).trim();
      const targetPortStr = String(req?.port ?? port).trim() || '21118';
      const targetPort = Number(targetPortStr) || 21118;
      const targetPassword = req?.password ?? password;
      const targetGatewayToken = req?.gatewayToken ?? gatewayToken;
      const shouldRemember = req?.remember ?? false;
      const targetDeviceKey = deviceKeyFor({
        mode: activeMode,
        peerId: targetPeerId,
        host: targetHost,
        port: targetPortStr,
      });

      const wc = webCodecsStatus();
      if (!wc.ok) {
        setPhase('error');
        setDecoderError(wc.reason);
        setStatusDetail(null, wc.reason);
        setConnectDialog(true);
        return;
      }

      if (activeMode === 'direct' && !targetHost) {
        setPhase('error');
        setStatusDetail('detailMissingHost');
        return;
      }
      if (activeMode === 'id' && (!targetPeerId || !targetIdServer)) {
        setPhase('error');
        setStatusDetail('detailMissingId');
        return;
      }

      const rawSupport = await probeCodecs();
      if (generation !== connectGeneration.current) return;
      if (
        !rawSupport.vp8 &&
        !rawSupport.vp9 &&
        !rawSupport.h264 &&
        !rawSupport.h265 &&
        !rawSupport.av1
      ) {
        setPhase('error');
        setDecoderError(t(locale, 'detailNoCodecs'));
        setStatusDetail('detailNoCodecs');
        setConnectDialog(true);
        return;
      }
      const preferredCodec = displayPrefsRef.current.codec;
      const support = filterCodecSupport(rawSupport, preferredCodec);

      clearSessionMessages();
      // Close previous socket & decoder cleanly
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.onerror = null;
        wsRef.current.onmessage = null;
        wsRef.current.close();
        wsRef.current = null;
      }
      decoderRef.current?.close();
      frameStatsRef.current = createFrameStats();
      statAccRef.current = {
        width: 0,
        height: 0,
        decoded: 0,
        dropped: 0,
        lastDelayMs: 0,
        lastCodec: '—',
      };

      const initialQuality = displayPrefsRef.current.qualityPreset;
      const customQuality = initialQuality === 'custom' ? displayPrefsRef.current.customBitrate : undefined;
      const initialFps = displayPrefsRef.current.targetFps;

      setPeer(null);
      setPrivacyEnabled(false);
      setPrivacyPending(false);
      setResolutionOptions(null);
      setCursorShape(null);
      setCursorEmbedded(false);
      lastInputPointRef.current = null;
      placeCursor(sizeRef.current.width / 2, sizeRef.current.height / 2);
      setStats(EMPTY_STATS);
      setQuality(initialQuality);
      setTargetFps(initialFps);
      setGatewayVideo(undefined);
      setRtt(0);
      resetDiagnostics();
      setDecoderError('');
      setMenuOpen(false);
      setSoftKeys(false);
      phaseRef.current = 'connecting';
      setPhase('connecting');
      setStatusDetail('detailOpeningSocket');

      const sock = webRtcOptIn && webRtcEnabled && activeMode === 'id' && !targetForceRelay
        ? new RemoteSocket(wsUrl())
        : new WebSocket(wsUrl());
      sock.binaryType = 'arraybuffer';
      wsRef.current = sock;
      let receivedTerminalError = false;

      sock.onopen = () => {
        if (wsRef.current !== sock) return;
        setStatusDetail('detailAuthenticating');
        if (activeMode === 'id') {
          sock.send(
            JSON.stringify({
              type: 'connect',
              media: { cursorIds: true },
              mode: 'id',
              peerId: targetPeerId,
              idServer: targetIdServer,
              relayServer: targetRelayServer,
              key: targetServerKey,
              forceRelay: targetForceRelay,
              password: targetPassword,
              token: targetGatewayToken,
              codecs: support,
              quality: initialQuality,
              customQuality,
              lockAfterSessionEnd: displayPrefsRef.current.lockAfterSessionEnd,
              fps: initialFps,
              codec: preferredCodec,
            }),
          );
        } else {
          sock.send(
            JSON.stringify({
              type: 'connect',
              media: { cursorIds: true },
              mode: 'direct',
              host: targetHost,
              port: targetPort,
              password: targetPassword,
              token: targetGatewayToken,
              codecs: support,
              quality: initialQuality,
              customQuality,
              lockAfterSessionEnd: displayPrefsRef.current.lockAfterSessionEnd,
              fps: initialFps,
              codec: preferredCodec,
            }),
          );
        }
      };

      const handleSessionMessage = createSessionMessageHandler({
        ...context,
        connection: {
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
        },
        onTerminalError: () => { receivedTerminalError = true; clearSessionMessages(); },
      });

      messageDisposer.current = handleSessionMessage.dispose;

      sock.onmessage = (ev) => {
        if (wsRef.current !== sock) return;
        if (ev.data instanceof ArrayBuffer) {
          const packet = decodeFrame(ev.data);
          if (!packet) return;
          ensureDecoder().push(packet, canvasRef.current);
          noteFrame(
            packet.codecName,
            packet.width,
            packet.height,
            packet.data.byteLength,
            Date.now() - packet.gatewayUnixMs,
          );
          return;
        }

        if (typeof ev.data !== 'string') return;
        let msg: ServerMessage;
        try {
          msg = JSON.parse(ev.data) as ServerMessage;
        } catch {
          return;
        }

        handleSessionMessage(msg);
      };

      sock.onerror = () => {
        if (wsRef.current !== sock || receivedTerminalError || phaseRef.current === 'error') return;
        clearSessionMessages();
        const wasLive = phaseRef.current === 'live';
        phaseRef.current = 'error';
        setPhase('error');
        setConnectDialog(true);
        setMenuOpen(false);
        setStatusDetail(wasLive ? 'detailSessionDisconnected' : 'detailGatewayError');
      };

      sock.onclose = () => {
        if (wsRef.current !== sock) return;
        wsRef.current = null;
        clearSessionMessages();
        if (receivedTerminalError || phaseRef.current === 'error') {
          return;
        }
        if (phaseRef.current === 'connecting' || phaseRef.current === 'live') {
          const wasLive = phaseRef.current === 'live';
          phaseRef.current = 'error';
          setPhase('error');
          setConnectDialog(true);
          setMenuOpen(false);
          setStatusDetail(wasLive ? 'detailSessionDisconnected' : 'detailGatewayClosed');
        } else {
          phaseRef.current = 'idle';
          setPhase('idle');
        }
      };
    },
    [
      locale,
      mode,
      host,
      port,
      password,
      rememberDevicePassword,
      handleClearSavedPassword,
      peerId,
      idServer,
      relayServer,
      serverKey,
      forceRelay,
      gatewayToken,
      webRtcEnabled,
      webRtcOptIn,
      ensureDecoder,
      noteFrame,
      placeCursor,
      resetDiagnostics,
      setStatusDetail,
    ],
  );

  useEffect(() => {
    if (!restartState) {
      if (phase === 'idle' || phase === 'error') reconnectRequest.current = null;
      return;
    }
    if (restartState === 'requested' && phase !== 'live') {
      setRestartState('waiting');
      return;
    }
    if (restartState === 'waiting' && (phase === 'idle' || phase === 'error')) {
      const timer = window.setTimeout(() => {
        if (reconnectRequest.current && Date.now() < restartDeadline.current) {
          void connectSession(reconnectRequest.current, true);
        }
      }, 5000);
      return () => window.clearTimeout(timer);
    }
  }, [restartState, phase, connectSession]);

  useEffect(() => {
    if (!restartState) return;
    const timer = window.setTimeout(() => {
      setRestartState(null);
      setStatusDetail(restartState === 'requested' ? 'restartFailed' : 'retryEnded');
      if (restartState === 'requested') {
        setDecoderError(t(locale, 'restartFailed'));
        setMobilePanel('actions');
        setMenuOpen(true);
      }
    }, restartState === 'requested' ? 45000 : Math.max(0, restartDeadline.current - Date.now()));
    return () => window.clearTimeout(timer);
  }, [restartState, locale, setStatusDetail]);

  const requestRestart = () => {
    if (restartState || !peer?.restartAllowed || wsRef.current?.readyState !== WebSocket.OPEN) return;
    restartDeadline.current = Date.now() + 180000;
    setRestartState('requested');
    setMenuOpen(false);
    send({ type: 'restart' });
  };

  // Disconnect cleanly and return to idle state

  const disconnect = useCallback(() => {
    clearSessionMessages();
    connectGeneration.current++;
    setWebRtcFallbackReason(null);
    reconnectRequest.current = null;
    setRestartState(null);
    finishPendingClick();
    clearLongPress();
    // Native WebRTC can close synchronously while processing disconnect.
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.onerror = null;
      wsRef.current.onmessage = null;
    }
    send({ type: 'disconnect' });
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    decoderRef.current?.close();
    setMenuOpen(false);
    setToolbarExpanded(false);
    setConnectDialog(false);
    setSoftKeys(false);
    resetDiagnostics();
    phaseRef.current = 'idle';
    setPhase('idle');
    setStatusDetail('detailDisconnected');
  }, [clearLongPress, finishPendingClick, resetDiagnostics, send, setStatusDetail]);

  const handleDismissError = useCallback(() => {
    setDecoderError('');
    if (phaseRef.current === 'error') {
      setPhase('idle');
      setStatusDetail('detailIdle');
    }
  }, [setStatusDetail]);

  return { connectSession, disconnect, requestRestart, handleDismissError };
}
