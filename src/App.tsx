import { EMPTY_STATS, useVideoPipeline } from './hooks/useVideoPipeline';
import type { SoftKeyboardMode } from './hooks/useKeyboardViewport';
import { useClipboardSync } from './hooks/useClipboardSync';
import { usePreferences } from './hooks/usePreferences';
import { useSavedDevices } from './hooks/useSavedDevices';
import { useViewTransform } from './hooks/useViewTransform';
import { useRemoteKeyboard } from './hooks/useRemoteKeyboard';
import { useRemotePointer } from './hooks/useRemotePointer';
import { useGatewaySession } from './hooks/useGatewaySession';
import type { RemoteSocket } from './lib/remoteSocket';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { RemoteStage } from './components/RemoteStage';
import { RemoteAudio } from './lib/remoteAudio';
import { DiagnosticOverlay } from './components/DiagnosticOverlay';
import type { MobilePanel } from './components/MobileSessionPanel';
import { MobileDock } from './components/MobileDock';
import {
  RustDeskShell,
  type ConnectRequest,
  type ConnectionPhase,
} from './components/RustDeskShell';
import { SessionHandle } from './components/SessionHandle';
import { SessionMenu } from './components/SessionMenu';
import { SoftKeyboardBar } from './components/SoftKeyboardBar';
import {
  type SavedDevice,
} from './lib/devices';
import {
  persistDisplayPrefs,
  resolveQualityLevel,
  resolveTargetFps,
  type DisplayPrefs,
} from './lib/displayPrefs';
import {
  computeDiagnosticsSummary,
  createDiagnosticsState,
  PING_INTERVAL_MS,
  PING_TIMEOUT_MS,
  recordPingSent,
  sweepTimeouts,
  type DiagnosticsState,
  type DiagnosticsSummary,
} from './lib/diagnostics';
import { t, type I18nKey } from './lib/i18n';
import { shouldEnableRemotePointerInput } from './lib/inputIsolation';
import { remoteKeyboardProfile } from './lib/keys';
import {
  type ClientMessage,
  type PeerMessage,
  type QualityLevel,
  type ServerMessage,
} from './lib/protocol';

function detectCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(pointer: coarse)').matches ||
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0)
  );
}

export default function App() {
  const isCoarseDevice = detectCoarsePointer();
  const {
    directIpEnabled,
    setDirectIpEnabled,
    mode,
    setMode,
    host,
    setHost,
    port,
    setPort,
    peerId,
    setPeerId,
    idServer,
    setIdServer,
    relayServer,
    setRelayServer,
    serverKey,
    setServerKey,
    forceRelay,
    setForceRelay,
    handleToggleDirectIp,
    localePreference,
    locale,
    changeLocale,
    theme,
    changeTheme,
    displayPrefs,
    setDisplayPrefs,
    displayPrefsRef,
  } = usePreferences(isCoarseDevice);
  const [password, setPassword] = useState('');
  const {
    savedGatewayToken,
    setTemporaryGatewayToken,
    gatewayToken,
    gatewayTokenReady,
    gatewayTokenRejected,
    setGatewayTokenRejected,
    gatewayTokenReadFailed,
    saveGatewayToken,
    devices,
    setDevices,
    savedPasswords,
    passwordsReady,
    passwordStorageFailed,
    setPasswordStorageFailed,
    handleClearSavedPassword,
    rememberDevicePassword,
    handleToggleFavorite,
    handleRemoveDevice,
  } = useSavedDevices();
  const [authRequired, setAuthRequired] = useState(false);
  const [webRtcEnabled, setWebRtcEnabled] = useState(false);

  const handleSelectDevice = useCallback((device: SavedDevice) => {
    if (device.mode === 'direct') {
      setDirectIpEnabled(true);
    }
    setMode(device.mode);
    if (device.mode === 'id') {
      if (device.peerId) setPeerId(device.peerId);
      if (device.idServer) setIdServer(device.idServer);
      if (typeof device.relayServer === 'string') setRelayServer(device.relayServer);
      if (typeof device.serverKey === 'string') setServerKey(device.serverKey);
      if (typeof device.forceRelay === 'boolean') setForceRelay(device.forceRelay);
    } else {
      if (device.host) setHost(device.host);
      if (device.port) setPort(device.port);
    }
  }, []);

  const [phase, setPhase] = useState<ConnectionPhase>('idle');
  const [detailKey, setDetailKey] = useState<I18nKey | null>('detailIdle');
  const [rawDetail, setRawDetail] = useState('');
  const detail = detailKey ? t(locale, detailKey) : rawDetail;
  const setStatusDetail = useCallback((key: I18nKey | null, customText = '') => {
    setDetailKey(key);
    setRawDetail(customText);
  }, []);
  const [resolutionOptions, setResolutionOptions] = useState<Extract<ServerMessage, { type: 'resolutions' }> | null>(null);
  const followCursorRef = useRef<(x: number, y: number) => void>(() => {});
  const [peer, setPeer] = useState<PeerMessage | null>(null);
  const { shortcutModifier, showCtrlAltDel } = remoteKeyboardProfile(peer?.platform);
  const [display, setDisplay] = useState(0);
  const wsRef = useRef<WebSocket | RemoteSocket | null>(null);
  // Send JSON helper
  const send = useCallback((msg: ClientMessage) => {
    const sock = wsRef.current;
    if (sock && sock.readyState === WebSocket.OPEN) {
      sock.send(JSON.stringify(msg));
    }
  }, []);

  const {
    stats, setStats, decoderError, setDecoderError, decoderRef, sizeRef,
    frameStatsRef, statAccRef, ensureDecoder, noteFrame,
  } = useVideoPipeline({ phase, send });
  const [rtt, setRtt] = useState(0);
  const [gatewayVideo, setGatewayVideo] = useState<Extract<ServerMessage, { type: 'pong' }>['gatewayVideo']>();
  const [quality, setQuality] = useState<QualityLevel>(() =>
    resolveQualityLevel(displayPrefs.qualityPreset, displayPrefs.customBitrate),
  );
  const [targetFps, setTargetFps] = useState(() =>
    resolveTargetFps(displayPrefs.qualityPreset, displayPrefs.customFps),
  );
  const [sessionTip, setSessionTip] = useState<{ text: string; error: boolean } | null>(null);
  const [webRtcFallbackReason, setWebRtcFallbackReason] = useState<string | null>(null);
  const showSessionTip = useCallback((text: string, error = false) => {
    setSessionTip({ text, error });
  }, []);
  useEffect(() => {
    if (!sessionTip) return;
    const timer = window.setTimeout(() => setSessionTip(null), sessionTip.error ? 4000 : 2000);
    return () => window.clearTimeout(timer);
  }, [sessionTip]);
  useEffect(() => {
    if (phase !== 'live') setSessionTip(null);
  }, [phase]);
  const [privacyEnabled, setPrivacyEnabled] = useState(false);
  const [privacyPending, setPrivacyPending] = useState(false);
  useEffect(() => {
    if (!privacyPending) return;
    const timeout = window.setTimeout(() => {
      setPrivacyPending(false);
      showSessionTip(t(locale, 'privacyFailed'), true);
    }, 15000);
    return () => window.clearTimeout(timeout);
  }, [privacyPending, locale, showSessionTip]);
  const [clipboardSync, setClipboardSync] = useState(false);

  // Viewport & chrome state
  const [handleX, setHandleX] = useState(0.5);
  const [toolbarExpanded, setToolbarExpanded] = useState(false);
  const [toolbarPinned, setToolbarPinned] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('toolbar');
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectDialog, setConnectDialog] = useState(false);
  const [softKeys, setSoftKeys] = useState(false);
  const [softKeyboardMode, setSoftKeyboardMode] = useState<SoftKeyboardMode>('system');
  const [cursorEmbedded, setCursorEmbedded] = useState(false);
  const [cursorShape, setCursorShape] = useState<{
    pixels: ImageData;
    hotX: number;
    hotY: number;
  } | null>(null);
  const textCursor = useMemo(() => {
    if (!cursorShape || cursorEmbedded || !displayPrefs.autoKeyboard) return false;
    const { pixels, hotX, hotY } = cursorShape;
    // Ignore transparent padding. An I-beam has narrow middle rows and wider caps.
    const widths: number[] = [];
    let left = pixels.width, right = -1;
    for (let y = 0; y < pixels.height; y++) {
      let first = pixels.width, last = -1;
      for (let x = 0; x < pixels.width; x++) {
        if (pixels.data[(y * pixels.width + x) * 4 + 3] < 96) continue;
        first = Math.min(first, x);
        last = x;
      }
      widths.push(Math.max(0, last - first + 1));
      left = Math.min(left, first);
      right = Math.max(right, last);
    }
    const top = widths.findIndex(w => w > 0);
    if (top < 0) return false;
    let bottom = widths.length - 1;
    while (!widths[bottom]) bottom--;
    const height = bottom - top + 1, width = right - left + 1;
    const cap = Math.max(1, Math.floor(height / 4));
    const stem = widths.slice(top + cap, bottom - cap + 1);
    return height >= 8 && height >= width * 1.4 &&
      Math.abs(hotX - (left + right) / 2) <= Math.max(1, width / 4) &&
      Math.abs(hotY - (top + bottom) / 2) <= height / 3 &&
      stem.every(w => w > 0 && w <= width * 0.7) &&
      Math.max(...widths.slice(top, top + cap)) >= width * 0.8 &&
      Math.max(...widths.slice(bottom - cap + 1, bottom + 1)) >= width * 0.8;
  }, [cursorShape, cursorEmbedded, displayPrefs.autoKeyboard]);
  const [restartState, setRestartState] = useState<'requested' | 'waiting' | null>(null);
  const restartDeadline = useRef(0);
  const reconnectRequest = useRef<ConnectRequest | null>(null);
  const connectGeneration = useRef(0);
  const routeLabel = t(locale, peer?.route === 'webrtc-relay' ? 'routeWebRtcRelay' : peer?.route === 'webrtc' ? 'routeWebRtcUnknown' : peer?.route === 'webrtc-direct' ? 'routeWebRtc' : peer?.route === 'relay' ? 'routeRelay' : peer?.route === 'direct' ? 'routeDirect' : 'routeUnknown');
  const [diagnosticsOpen, setDiagnosticsOpen] = useState<boolean>(() => {
    try {
      return new URLSearchParams(window.location.search).get('diag') === '1';
    } catch {
      return false;
    }
  });
  const diagStateRef = useRef<DiagnosticsState>(createDiagnosticsState());
  const diagSeqRef = useRef(0);
  const [diagSummary, setDiagSummary] = useState<DiagnosticsSummary>(() =>
    computeDiagnosticsSummary(diagStateRef.current, performance.now()),
  );

  // Refs
  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorElRef = useRef<HTMLDivElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const softKeyboardInputRef = useRef<HTMLInputElement>(null);
  const phaseRef = useRef<ConnectionPhase>(phase);
  phaseRef.current = phase;

  const chromeRef = useRef({ menu: false, dialog: true });
  chromeRef.current = { menu: menuOpen, dialog: connectDialog || phase !== 'live' };

  // Mouse & touch gesture refs (unified deterministic TouchGestureState FSM)
  const cursorRef = useRef({ x: 640, y: 360 });
  const lastInputPointRef = useRef<{ x: number; y: number } | null>(null);
  const {
    viewMode,
    setViewMode,
    setZoom,
    setPan,
    box,
    visibleViewport,
    pageZoomed,
    remoteW,
    remoteH,
    viewRef,
    keyboardLayout,
    view,
    resetPageZoom,
    setScaleAround,
    applyPinchStepRef,
    panBy,
  } = useViewTransform({
    initialViewStyle: displayPrefs.viewStyle,
    isCoarseDevice,
    phase,
    softKeys,
    softKeyboardMode,
    stageRef,
    sizeRef,
    stats,
    cursorRef,
    lastInputPointRef,
    followCursorRef,
    onSystemDismiss: () => hideSoftKeyboard(),
  });

  const isMobileViewport =
    box.w > 0 ? box.w <= 768 : typeof window !== 'undefined' && window.innerWidth <= 768;
  const isTouchLayout = isCoarseDevice || isMobileViewport;
  const remoteInput = shouldEnableRemotePointerInput(phase, connectDialog, menuOpen, isTouchLayout);

  const clipboardAllowed = phase === 'live' && peer?.clipboardAllowed !== false && !displayPrefs.disableClipboard;
  const clipboard = useClipboardSync({
    enabled: clipboardSync && clipboardAllowed,
    send: text => {
      try {
        if (wsRef.current?.readyState !== WebSocket.OPEN) return false;
        wsRef.current.send(JSON.stringify({ type: 'clipboard', text }));
        return true;
      } catch { return false; }
    },
    notify: (key, error) => showSessionTip(t(locale, key), error),
  });
  useEffect(() => {
    if (!clipboardAllowed) setClipboardSync(false);
  }, [clipboardAllowed]);
  const toggleClipboardSync = () => {
    const enabled = !clipboardSync;
    flushSync(() => setClipboardSync(enabled));
    if (enabled) void clipboard.readLocal();
    else showSessionTip(t(locale, 'clipSyncOff'));
  };

  useEffect(() => {
    if (phase === 'live' && peer && peer.displays.length > 1) {
      send({ type: 'followWindow', enabled: displayPrefs.followWindow });
    }
  }, [phase, peer, displayPrefs.followWindow, send]);

  const audioRef = useRef<RemoteAudio | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);

  const stopAudio = useCallback(() => {
    const player = audioRef.current;
    audioRef.current = null;
    player?.close();
    setAudioEnabled(false);
  }, []);
  useEffect(() => {
    if (phase !== 'live') {
      stopAudio();
    }
    return () => { audioRef.current?.close(); audioRef.current = null; };
  }, [phase, stopAudio]);

  const toggleAudio = async () => {
    if (audioRef.current) {
      stopAudio();
      send({ type: 'audio', enabled: false });
      showSessionTip(t(locale, 'audioStopped'));
      return;
    }
    if (typeof AudioDecoder === 'undefined' || typeof AudioContext === 'undefined') {
      showSessionTip(t(locale, 'audioUnsupported'), true);
      return;
    }
    const socket = wsRef.current;
    let player: RemoteAudio;
    const fail = () => {
      if (socket !== wsRef.current || (player && player !== audioRef.current)) return;
      stopAudio();
      showSessionTip(t(locale, 'audioFailed'), true);
      send({ type: 'audio', enabled: false });
    };
    try {
      player = new RemoteAudio(fail);
      audioRef.current = player;
      setAudioEnabled(true);
      await player.resume();
      if (player === audioRef.current && socket === wsRef.current) {
        send({ type: 'audio', enabled: true });
        showSessionTip(t(locale, 'audioRequested'));
      }
    } catch {
      fail();
    }
  };

  const focusDesktopCapture = useCallback(() => {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    captureRef.current?.focus({ preventScroll: true });
  }, []);

  const closeChrome = useCallback(() => {
    chromeRef.current = { menu: false, dialog: false };
    setMenuOpen(false);
    setConnectDialog(false);
    focusDesktopCapture();
  }, [focusDesktopCapture]);

  const hideSoftKeyboard = useCallback(() => {
    setSoftKeys(false);
    focusDesktopCapture();
  }, [focusDesktopCapture]);

  const openSoftKeyboard = useCallback(() => {
    keyboardLayout.begin();
    // iOS requires focus during the original tap to open the system keyboard.
    flushSync(() => {
      closeChrome();
      setSoftKeyboardMode('system');
      setSoftKeys(true);
    });
    softKeyboardInputRef.current?.focus({ preventScroll: true });
  }, [closeChrome, keyboardLayout.begin]);

  const switchSoftKeyboard = (mode: SoftKeyboardMode) => {
    keyboardLayout.switchMode(mode);
    if (mode === 'virtual') softKeyboardInputRef.current?.blur();
    flushSync(() => setSoftKeyboardMode(mode));
    if (mode === 'system') softKeyboardInputRef.current?.focus({ preventScroll: true });
  };

  const toggleSoftKeyboard = () => {
    if (softKeys) {
      closeChrome();
      hideSoftKeyboard();
    } else {
      openSoftKeyboard();
    }
  };

  const {
    touchMode,
    virtualCursorVisible,
    touchGestureRef,
    moveRafRef,
    placeCursor,
    finishPendingClick,
    clearLongPress,
    handlePointerDown,
    handlePointerMove,
    handlePointerUpOrCancel,
    handleLostPointerCapture,
    handleToggleTouchMode,
  } = useRemotePointer({
    isCoarseDevice,
    isMobileViewport,
    isTouchLayout,
    remoteInput,
    send,
    displayPrefsRef,
    stageRef,
    canvasRef,
    cursorElRef,
    cursorCanvasRef,
    cursorShape,
    sizeRef,
    cursorRef,
    lastInputPointRef,
    followCursorRef,
    viewRef,
    view,
    remoteW,
    remoteH,
    panBy,
    setScaleAround,
    applyPinchStepRef,
    openSoftKeyboard,
    softKeys,
    textCursor,
    chromeRef,
    closeChrome,
    focusDesktopCapture,
    toolbarExpanded,
    toolbarPinned,
    setToolbarExpanded,
  });

  // Expose window.__rd and window.__rdView on every render
  useEffect(() => {
    window.__rd = {
      state: phase,
      codec: stats.codec,
      width: stats.width,
      height: stats.height,
      fps: stats.fps,
      delayMs: rtt || stats.delayMs,
      bitrate: stats.bitrate,
      decoded: stats.decoded,
      cursorX: Math.round(cursorRef.current.x),
      cursorY: Math.round(cursorRef.current.y),
      touchMode,
      gesturePhase: touchGestureRef.current.phase,
      activePointers: touchGestureRef.current.pointers.size,
    };
    window.__rdView = {
      scale: view.scale,
      panX: view.panX,
      panY: view.panY,
      width: box.w,
      height: box.h,
    };
    window.__rdDiag = diagSummary;
  }, [phase, stats, rtt, touchMode, view.scale, view.panX, view.panY, box.w, box.h, diagSummary]);

  const resetDiagnostics = useCallback(() => {
    diagStateRef.current = createDiagnosticsState();
    diagSeqRef.current = 0;
    setDiagSummary(computeDiagnosticsSummary(diagStateRef.current, performance.now()));
  }, []);

  // Raw WebSocket ping-pong probing when Diagnostic Overlay is active during a session
  useEffect(() => {
    if (!diagnosticsOpen || phase !== 'live') {
      return;
    }

    const sendProbe = () => {
      const sock = wsRef.current;
      const now = performance.now();
      diagStateRef.current = sweepTimeouts(diagStateRef.current, now, PING_TIMEOUT_MS);
      if (sock && sock.readyState === WebSocket.OPEN) {
        const seq = diagSeqRef.current + 1;
        diagSeqRef.current = seq;
        diagStateRef.current = recordPingSent(diagStateRef.current, seq, now);
        sock.send(JSON.stringify({ type: 'ping', seq, clientTs: now }));
      }
      setDiagSummary(computeDiagnosticsSummary(diagStateRef.current, now, PING_TIMEOUT_MS));
    };

    sendProbe();
    const timer = window.setInterval(sendProbe, PING_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
    };
  }, [diagnosticsOpen, phase]);

  const { connectSession, disconnect, requestRestart, handleDismissError } = useGatewaySession({
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
    mode,
    password,
    gatewayToken,
    webRtcEnabled,
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
    emptyStats: EMPTY_STATS,
    setQuality,
    setTargetFps,
    setSoftKeys,
    setToolbarExpanded,
    ensureDecoder,
    noteFrame,
    resetDiagnostics,
    finishPendingClick,
    clearLongPress,
  });

  const handleUpdateDisplayPrefs = useCallback(
    (patch: Partial<DisplayPrefs>) => {
      setDisplayPrefs((prev) => {
        const next: DisplayPrefs = { ...prev, ...patch };
        persistDisplayPrefs(next);

        if (patch.viewStyle) {
          setViewMode(patch.viewStyle);
          if (patch.viewStyle === 'fit') {
            setZoom(1);
            setPan({ panX: 0, panY: 0 });
          } else {
            setPan({
              panX: (box.w - remoteW) / 2,
              panY: (box.h - remoteH) / 2,
            });
          }
        }

        if (
          patch.qualityPreset !== undefined ||
          patch.customBitrate !== undefined ||
          patch.customFps !== undefined ||
          patch.codec !== undefined
        ) {
          const nextQ = resolveQualityLevel(next.qualityPreset, next.customBitrate);
          const nextFps = resolveTargetFps(next.qualityPreset, next.customFps);
          setQuality(nextQ);
          setTargetFps(nextFps);
          send({ type: 'quality', quality: nextQ, fps: nextFps, codec: next.codec });
        }

        return next;
      });
    },
    [box.w, box.h, remoteW, remoteH, send],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      finishPendingClick();
      clearLongPress();
      if (moveRafRef.current !== null) cancelAnimationFrame(moveRafRef.current);
      wsRef.current?.close();
      decoderRef.current?.close();
    };
  }, [clearLongPress, finishPendingClick]);

  const {
    captureComposingRef,
    lastCompositionEndAtRef,
    sendText,
    sendChord,
    handleQuickKey,
  } = useRemoteKeyboard({
    send,
    closeChrome,
    chromeRef,
    phaseRef,
    displayPrefsRef,
    shortcutModifier,
    showCtrlAltDel,
  });

  const showConnectSheet = phase !== 'live' || connectDialog;
  const showSessionMenu = menuOpen && phase === 'live' && !connectDialog;
  const showHandle = phase === 'live' && !connectDialog && !menuOpen && !isTouchLayout;
  const showMobileDock = phase === 'live' && !connectDialog && !softKeys && isTouchLayout;
  const liveHostTitle =
    peer?.hostname || peer?.username || (mode === 'id' ? peerId : host) || 'Remote';
  const showRemoteCursor =
    displayPrefs.showRemoteCursor &&
    !cursorEmbedded &&
    (isTouchLayout || virtualCursorVisible) &&
    phase === 'live';

  const stageViewport = keyboardLayout.viewport ?? visibleViewport;

  return (
    <RemoteStage
      stageRef={stageRef}
      live={phase === 'live'}
      stageViewport={stageViewport}
      keyboardAvoiding={Boolean(keyboardLayout.viewport)}
      remoteInput={remoteInput}
      scrollStyle={displayPrefs.scrollStyle}
      pointer={{ handlePointerDown, handlePointerMove, handlePointerUpOrCancel, handleLostPointerCapture }}
      canvas={{ canvasRef, remoteW, remoteH, view }}
      cursor={{ cursorElRef, cursorCanvasRef, cursorShape, showRemoteCursor, enlargeCursor: displayPrefs.enlargeCursor }}
      capture={{ captureRef, captureComposingRef, lastCompositionEndAtRef, displayPrefsRef, sendText }}
    >
      {pageZoomed && (
        <div
          className="page-zoom-banner"
          data-testid="page-zoom-banner"
          role="status"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span>{t(locale, 'pageZoomedBanner')}</span>
          <button
            type="button"
            className="rd-btn primary"
            style={{ minHeight: 32, padding: '4px 10px' }}
            data-testid="page-zoom-reset"
            onClick={resetPageZoom}
          >
            {t(locale, 'reset')}
          </button>
        </div>
      )}

      {showHandle && (
        <SessionHandle
          locale={locale}
          handleX={handleX}
          stageWidth={box.w}
          expanded={toolbarExpanded}
          pinned={toolbarPinned}
          hostTitle={liveHostTitle}
          displays={peer?.displays ?? []}
          activeDisplay={display}
          viewMode={viewMode}
          hasWarning={Boolean(decoderError)}
          onMoveHandle={setHandleX}
          onSetExpanded={setToolbarExpanded}
          onTogglePinned={() => setToolbarPinned((prev) => !prev)}
          onSwitchDisplay={(idx) => {
            setDisplay(idx);
            send({ type: 'switchDisplay', display: idx });
          }}
          onToggleViewMode={() => {
            if (viewMode === 'fit') {
              setViewMode('original');
              setPan({
                panX: (box.w - remoteW) / 2,
                panY: (box.h - remoteH) / 2,
              });
            } else {
              setViewMode('fit');
              setZoom(1);
              setPan({ panX: 0, panY: 0 });
            }
          }}
          onToggleKeyboard={toggleSoftKeyboard}
          onCtrlAltDel={showCtrlAltDel && !displayPrefs.viewOnly ? () => handleQuickKey('Ctrl+Alt+Del') : undefined}
          onOpenMenu={() => setMenuOpen(true)}
          onDisconnect={disconnect}
        />
      )}

      {restartState && <div className="restart-notice" role="status">
        {t(locale, restartState === 'requested' ? 'restartWaiting' : 'retryWaiting')}
        <button type="button" onClick={restartState === 'requested' ? () => setRestartState(null) : disconnect}>{t(locale,'cancel')}</button>
      </div>}
      {diagnosticsOpen && phase === 'live' && (
        <DiagnosticOverlay
          locale={locale}
          stats={stats}
          summary={diagSummary}
          routeLabel={routeLabel}
          browserDirect={peer?.route?.startsWith('webrtc')}
          encryptionLabel={t(locale, peer?.encrypted ? 'linkEncrypted' : 'linkPlain')}
          hostRttMs={rtt}
          targetFps={targetFps}
          gatewayVideo={gatewayVideo}
          onClose={() => setDiagnosticsOpen(false)}
        />
      )}

      {(phase === 'live' || webRtcFallbackReason !== null) && (
        <div className="session-tip-region" aria-live="polite" aria-atomic="true">
          {webRtcFallbackReason !== null && (
            <div className="session-tip fallback-tip" data-testid="webrtc-fallback-tip" data-session-notice
              onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}
              onPointerMove={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
              <span>{t(locale, 'webRtcFallback')}<br />{webRtcFallbackReason}</span>
              <button type="button" data-testid="webrtc-fallback-dismiss" aria-label={t(locale, 'close')}
                onClick={() => setWebRtcFallbackReason(null)}>×</button>
            </div>
          )}
          {phase === 'live' && sessionTip && <div className="session-tip" data-testid="session-tip">{sessionTip.text}</div>}
          {phase === 'live' && clipboardSync && clipboardAllowed && clipboard.pending && (
            <div className="session-tip clipboard-tip" data-testid="clipboard-tip"
              onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
              <span>{t(locale, clipboard.pending === 'write' ? 'clipRemoteReady' : 'clipLocalReady')}</span>
              <button type="button" onClick={() => { void (clipboard.pending === 'write' ? clipboard.writeRemote() : clipboard.readLocal()); }}>
                {t(locale, clipboard.pending === 'write' ? 'copy' : 'clipSyncAction')}
              </button>
              <button type="button" aria-label={t(locale, 'close')} onClick={clipboard.dismiss}>×</button>
            </div>
          )}
        </div>
      )}
      {showMobileDock && (
        <MobileDock
          locale={locale}
          activePanel={menuOpen ? mobilePanel : null}
          touchMode={touchMode}
          onToggleTouchMode={() => {
            handleToggleTouchMode();
            setMobilePanel('toolbar');
          }}
          onToggleKeyboard={toggleSoftKeyboard}
          onCollapse={closeChrome}
          onOpenMenu={panel => {
            setMobilePanel(current => menuOpen && panel === current ? 'toolbar' : panel);
            setMenuOpen(true);
          }}
        />
      )}

      {passwordStorageFailed && <div className="restart-notice" role="alert">{t(locale, 'passwordStorageFailed')} <button onClick={() => setPasswordStorageFailed(false)}>OK</button></div>}
      {showConnectSheet && passwordsReady && gatewayTokenReady && (
        <RustDeskShell
          locale={locale}
          localePreference={localePreference}
          isDesktop={!(isMobileViewport || (isCoarseDevice && box.h > 0 && box.h <= 540 && box.w > box.h))}
          theme={theme}
          displayPrefs={displayPrefs}
          onChangeLocale={changeLocale}
          onChangeTheme={changeTheme}
          onUpdateDisplayPrefs={handleUpdateDisplayPrefs}
          mode={mode}
          directIpEnabled={directIpEnabled}
          phase={phase}
          host={host}
          port={port}
          password={password}
          peerId={peerId}
          idServer={idServer}
          relayServer={relayServer}
          serverKey={serverKey}
          forceRelay={forceRelay}
          gatewayToken={gatewayToken}
          savedGatewayToken={savedGatewayToken}
          gatewayTokenNeedsInput={authRequired && (!gatewayToken.trim() || gatewayTokenRejected)}
          gatewayTokenReadFailed={gatewayTokenReadFailed}
          onSaveGatewayToken={saveGatewayToken}
          detail={detail}
          decoderError={decoderError}
          touchMode={touchMode}
          diagnosticsOpen={diagnosticsOpen}
          devices={devices}
          savedPasswords={savedPasswords}
          onChangeMode={setMode}
          onToggleDirectIp={handleToggleDirectIp}
          onChangeField={(field, val) => {
            if (field === 'host') setHost(val);
            else if (field === 'port') setPort(val);
            else if (field === 'password') setPassword(val);
            else if (field === 'peerId') setPeerId(val);
            else if (field === 'idServer') setIdServer(val);
            else if (field === 'relayServer') setRelayServer(val);
            else if (field === 'serverKey') setServerKey(val);
          }}
          onChangeForceRelay={setForceRelay}
          onClearSavedPassword={handleClearSavedPassword}
          onSelectDevice={handleSelectDevice}
          onToggleFavorite={handleToggleFavorite}
          onRemoveDevice={handleRemoveDevice}
          onToggleTouchMode={handleToggleTouchMode}
          onToggleDiagnostics={() => setDiagnosticsOpen((prev) => !prev)}
          onConnect={(req) => void connectSession(req)}
          onDisconnect={disconnect}
          onDismissError={handleDismissError}
          onClose={closeChrome}
        />
      )}

      {showSessionMenu && (
        <SessionMenu
          clipboardSync={clipboardSync && clipboardAllowed}
          clipboardAllowed={clipboardAllowed}
          onToggleClipboardSync={toggleClipboardSync}
          onNotify={showSessionTip}
          onRestart={requestRestart}
          mobilePanel={mobilePanel}
          locale={locale}
          audioEnabled={audioEnabled}
          onToggleAudio={toggleAudio}
          mobileLayout={isTouchLayout}
          followWindow={displayPrefs.followWindow}
          onToggleFollowWindow={() => handleUpdateDisplayPrefs({ followWindow: !displayPrefs.followWindow })}
          phase={phase}
          peer={peer}
          decoderError={decoderError}
          display={display}
          touchMode={touchMode}
          viewOnly={displayPrefs.viewOnly}
          sizes={resolutionOptions?.display === display ? resolutionOptions.sizes : []}
          onResolution={(width, height) => send({ type: 'resolution', display, width, height })}
          diagnosticsOpen={diagnosticsOpen}
          stats={stats}
          rtt={rtt}
          quality={quality}
          targetFps={targetFps}
          preferredCodec={displayPrefs.codec}
          privacyEnabled={privacyEnabled}
          privacyPending={privacyPending}
          onTogglePrivacy={() => {
            if (!peer?.privacyAllowed || privacyPending || displayPrefs.viewOnly) return;
            setPrivacyPending(true);
            showSessionTip(t(locale, 'privacyWaiting'));
            send({ type: 'privacy', enabled: !privacyEnabled });
          }}
          onClose={closeChrome}
          onOpenConnection={() => {
            setMenuOpen(false);
            setConnectDialog(true);
          }}
          onDisconnect={disconnect}
          onToggleDiagnostics={() => {
            setDiagnosticsOpen(true);
            setMenuOpen(false);
          }}
          onToggleTouchMode={handleToggleTouchMode}
          reverseScroll={displayPrefs.reverseMouseWheel}
          onReverseScrollChange={reverseMouseWheel => handleUpdateDisplayPrefs({ reverseMouseWheel })}
          onSwitchDisplay={(idx) => {
            setDisplay(idx);
            send({ type: 'switchDisplay', display: idx });
          }}
          onQuickKey={handleQuickKey}
          onChangeQuality={(q, fps, nextCodec) => {
            setQuality(q);
            setTargetFps(fps);
            const activeCodec = nextCodec ?? displayPrefsRef.current.codec;
            if (nextCodec && nextCodec !== displayPrefsRef.current.codec) {
              setDisplayPrefs((prev) => {
                const updated = { ...prev, codec: nextCodec };
                persistDisplayPrefs(updated);
                return updated;
              });
            }
            send({ type: 'quality', quality: q, fps, codec: activeCodec });
          }}
        />
      )}

      {softKeys && remoteInput && (
        <SoftKeyboardBar
          onPasteText={clipboardSync && clipboardAllowed ? text => { clipboard.sendLocal(text); } : undefined}
          locale={locale}
          remotePlatform={peer?.platform}
          inputRef={softKeyboardInputRef}
          mode={softKeyboardMode}
          reservedSpace={keyboardLayout.reservedSpace}
          viewportHeight={stageViewport?.height ?? box.h}
          onSwitchMode={switchSoftKeyboard}
          onSendText={sendText}
          onSendControl={(action, control) => send({ type: 'key', action, control })}
          onSendChord={sendChord}
          onHide={hideSoftKeyboard}
        />
      )}
    </RemoteStage>
  );
}
