import { EMPTY_STATS, useVideoPipeline } from './hooks/useVideoPipeline';
import type { SoftKeyboardMode } from './hooks/useKeyboardViewport';
import { useClipboardSync } from './hooks/useClipboardSync';
import { usePreferences } from './hooks/usePreferences';
import { useSavedDevices } from './hooks/useSavedDevices';
import { useViewTransform } from './hooks/useViewTransform';
import { useRemoteKeyboard } from './hooks/useRemoteKeyboard';
import { RemoteSocket } from './lib/remoteSocket';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { MousePointer2 } from 'lucide-react';
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
import { probeCodecs, webCodecsStatus } from './lib/decoder';
import {
  deviceKeyFor,
  upsertRecentDevice,
  type SavedDevice,
} from './lib/devices';
import {
  applyMouseButtonSwap,
  applyWheelDirection,
  filterCodecSupport,
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
  recordPongReceived,
  sweepTimeouts,
  type DiagnosticsState,
  type DiagnosticsSummary,
} from './lib/diagnostics';
import {
  accumulateWheelTicks,
  consumeThreeFingerScroll,
  createTouchGestureState,
  gestureLongPressTimeout,
  gesturePointerDown,
  gesturePointerMove,
  gesturePointerUpOrCancel,
  LONG_PRESS_MS,
  MAX_WHEEL_TICKS_PER_EVENT,
  resetTouchGestureState,
  type TouchGestureEffect,
  type TouchGestureState,
} from './lib/gestures';
import { t, type I18nKey } from './lib/i18n';
import {
  isBrowserNavOrAuxButton,
  shouldEnableRemotePointerInput,
  shouldPreventStageTouch,
  shouldPreventWindowWheel,
} from './lib/inputIsolation';
import { remoteKeyboardProfile } from './lib/keys';
import {
  mapFromRemote,
  mapToRemote,
  mapToRemoteClamped,
} from './lib/mapping';
import {
  decodeFrame,
  wsUrl,
  type ClientMessage,
  type PeerMessage,
  type QualityLevel,
  type ServerMessage,
} from './lib/protocol';
import { createFrameStats } from './lib/stats';

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
  const [touchMode, setTouchMode] = useState<boolean>(isCoarseDevice);
  const [handleX, setHandleX] = useState(0.5);
  const [toolbarExpanded, setToolbarExpanded] = useState(false);
  const [toolbarPinned, setToolbarPinned] = useState(false);
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>('toolbar');
  const [menuOpen, setMenuOpen] = useState(false);
  const [connectDialog, setConnectDialog] = useState(false);
  const [softKeys, setSoftKeys] = useState(false);
  const [softKeyboardMode, setSoftKeyboardMode] = useState<SoftKeyboardMode>('system');
  const [virtualCursorVisible, setVirtualCursorVisible] = useState(false);
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
  const touchGestureRef = useRef<TouchGestureState>(createTouchGestureState());
  const nativeScrollRef = useRef<{ y: number; remainder: number; count: number; x: number; anchorY: number } | null>(null);
  const touchFallbackPinchRef = useRef<{ midX: number; midY: number; dist: number } | null>(null);
  const nativeTouchInfoRef = useRef<{ count: number; updatedAt: number }>({ count: 0, updatedAt: 0 });
  const zeroTouchTimerRef = useRef<number | null>(null);
  const wheelAccumRef = useRef({ x: 0, y: 0 });
  const lastTouchAtRef = useRef(0);
  const longTimerRef = useRef<number | null>(null);
  const touchModeRef = useRef(touchMode);
  touchModeRef.current = touchMode;
  const pendingClickRef = useRef<{
    button: 'left' | 'right' | 'middle';
    x: number;
    y: number;
    timer: number;
  } | null>(null);

  // Desktop pointer state
  const desktopDragRef = useRef<{
    pointerId: number;
    mode: 'remote' | 'pan';
    button: 'left' | 'right' | 'middle';
    lastX: number;
    lastY: number;
  } | null>(null);

  // Throttled rAF mouse move queue
  const queuedMoveRef = useRef<{ x: number; y: number } | null>(null);
  const moveRafRef = useRef<number | null>(null);

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
  const remoteInputRef = useRef(remoteInput);
  remoteInputRef.current = remoteInput;

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

  const cancelQueuedMove = useCallback(() => {
    if (moveRafRef.current !== null) {
      cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = null;
    }
    queuedMoveRef.current = null;
  }, []);

  const flushMove = useCallback(() => {
    if (moveRafRef.current !== null) {
      cancelAnimationFrame(moveRafRef.current);
      moveRafRef.current = null;
    }
    const pos = queuedMoveRef.current;
    queuedMoveRef.current = null;
    if (pos && remoteInputRef.current) {
      send({ type: 'mouse', action: 'move', x: pos.x, y: pos.y });
    }
  }, [send]);

  const queueMove = useCallback(
    (pos: { x: number; y: number }) => {
      queuedMoveRef.current = pos;
      if (moveRafRef.current === null) {
        moveRafRef.current = requestAnimationFrame(() => {
          moveRafRef.current = null;
          const next = queuedMoveRef.current;
          queuedMoveRef.current = null;
          if (next && remoteInputRef.current) {
            send({ type: 'mouse', action: 'move', x: next.x, y: next.y });
          }
        });
      }
    },
    [send],
  );

  const finishPendingClick = useCallback(() => {
    const pending = pendingClickRef.current;
    if (!pending) return;
    window.clearTimeout(pending.timer);
    pendingClickRef.current = null;
    send({
      type: 'mouse',
      action: 'up',
      button: pending.button,
      x: pending.x,
      y: pending.y,
    });
  }, [send]);

  const clearLongPress = useCallback(() => {
    if (longTimerRef.current !== null) {
      window.clearTimeout(longTimerRef.current);
      longTimerRef.current = null;
    }
  }, []);

  const cursorPoint = useCallback(() => {
    const w = Math.max(1, sizeRef.current.width);
    const h = Math.max(1, sizeRef.current.height);
    return {
      x: Math.min(w - 1, Math.max(0, Math.round(cursorRef.current.x))),
      y: Math.min(h - 1, Math.max(0, Math.round(cursorRef.current.y))),
    };
  }, []);

  const placeCursor = useCallback((x: number, y: number) => {
    const w = Math.max(1, sizeRef.current.width);
    const h = Math.max(1, sizeRef.current.height);
    const cx = Math.min(w - 1, Math.max(0, x));
    const cy = Math.min(h - 1, Math.max(0, y));
    cursorRef.current = { x: cx, y: cy };
    if (displayPrefsRef.current.followRemoteCursor) followCursorRef.current(cx, cy);
    if (window.__rd) {
      window.__rd.cursorX = Math.round(cx);
      window.__rd.cursorY = Math.round(cy);
    }
    const el = cursorElRef.current;
    if (el) {
      const screen = mapFromRemote(cx, cy, viewRef.current);
      if (el.style.visibility) el.style.removeProperty('visibility');
      el.style.left = `${screen.x}px`;
      el.style.top = `${screen.y}px`;
    }
  }, []);

  const clickButton = useCallback(
    (button: 'left' | 'right' | 'middle', x: number, y: number) => {
      if (displayPrefsRef.current.viewOnly) return;
      const mapped = applyMouseButtonSwap(button, displayPrefsRef.current.swapMouseButtons);
      if (mapped === 'left') lastInputPointRef.current = { x, y };
      finishPendingClick();
      if (touchModeRef.current) placeCursor(x, y);
      send({ type: 'mouse', action: 'move', x, y });
      send({ type: 'mouse', action: 'down', button: mapped, x, y });
      const timer = window.setTimeout(() => {
        pendingClickRef.current = null;
        send({ type: 'mouse', action: 'up', button: mapped, x, y });
      }, 40);
      pendingClickRef.current = { button: mapped, x, y, timer };
    },
    [finishPendingClick, placeCursor, send],
  );

  // Keep virtual cursor DOM position synchronized on view changes
  useEffect(() => {
    const el = cursorElRef.current;
    if (!el) return;
    const screen = mapFromRemote(cursorRef.current.x, cursorRef.current.y, view);
    el.style.left = `${screen.x}px`;
    el.style.top = `${screen.y}px`;
  }, [view.scale, view.panX, view.panY, virtualCursorVisible]);

  useEffect(() => {
    if (cursorShape) {
      cursorCanvasRef.current?.getContext('2d')?.putImageData(cursorShape.pixels, 0, 0);
    }
  }, [cursorShape]);

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

      const initialQuality = resolveQualityLevel(
        displayPrefsRef.current.qualityPreset,
        displayPrefsRef.current.customBitrate,
      );
      const initialFps = resolveTargetFps(
        displayPrefsRef.current.qualityPreset,
        displayPrefsRef.current.customFps,
      );

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
      setPhase('connecting');
      setStatusDetail('detailOpeningSocket');

      const sock = webRtcEnabled && activeMode === 'id' && !targetForceRelay ? new RemoteSocket(wsUrl()) : new WebSocket(wsUrl());
      sock.binaryType = 'arraybuffer';
      wsRef.current = sock;
      let receivedTerminalError = false;
      let sessionDisplays: PeerMessage['displays'] = [];
      let activeDisplay = 0;
      let cursorDisplayOrigin = { x: 0, y: 0 };

      sock.onopen = () => {
        if (wsRef.current !== sock) return;
        setStatusDetail('detailAuthenticating');
        if (activeMode === 'id') {
          sock.send(
            JSON.stringify({
              type: 'connect',
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
              fps: initialFps,
              codec: preferredCodec,
            }),
          );
        } else {
          sock.send(
            JSON.stringify({
              type: 'connect',
              mode: 'direct',
              host: targetHost,
              port: targetPort,
              password: targetPassword,
              token: targetGatewayToken,
              codecs: support,
              quality: initialQuality,
              fps: initialFps,
              codec: preferredCodec,
            }),
          );
        }
      };

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

        switch (msg.type) {
          case 'webrtcFallback':
            setWebRtcFallbackReason(msg.reason);
            break;
          case 'status':
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
              if (msg.detail && /password|token|two.factor/i.test(msg.detail)) setRestartState(null);
              receivedTerminalError = true;
              phaseRef.current = 'error';
              setPhase('error');
              setConnectDialog(true);
              setMenuOpen(false);
              if (msg.detail && /password/i.test(msg.detail)) {
                // Clear stale remembered password so the next attempt prompts cleanly
                handleClearSavedPassword(targetDeviceKey);
              }
              if (msg.detail && /token/i.test(msg.detail)) {
                setAuthRequired(true);
                setGatewayTokenRejected(true);
                setStatusDetail('detailTokenError');
              } else if (msg.detail) {
                setStatusDetail(null, msg.detail);
              } else {
                setStatusDetail('detailHostRejected');
              }
            } else if (msg.state === 'closed') {
              phaseRef.current = 'idle';
              setPhase('idle');
              setStatusDetail('detailDisconnected');
            }
            break;

          case 'peer': {
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
                      peerId: peerId.replace(/\s+/g, ''),
                      idServer: idServer.trim(),
                      relayServer: relayServer.trim(),
                      serverKey: serverKey.trim(),
                      forceRelay,
                      hostname: msg.hostname || '',
                      platform: msg.platform || '',
                    }
                  : {
                      mode: 'direct',
                      host: host.trim(),
                      port: port.trim() || '21118',
                      hostname: msg.hostname || '',
                      platform: msg.platform || '',
                    },
                Date.now(),
              ),
            );
            break;
          }

          case 'permissions':
            setPeer(previous => previous ? { ...previous, privacyAllowed: msg.privacyAllowed, clipboardAllowed: msg.clipboardAllowed } : previous);
            if (!msg.privacyAllowed) setPrivacyPending(false);
            break;
          case 'privacyResult':
            showSessionTip(t(locale, msg.failed ? 'privacyFailed' : msg.enabled ? 'privacyOn' : 'privacyOff'), msg.failed);
            if (typeof msg.enabled === 'boolean') setPrivacyEnabled(msg.enabled);
            setPrivacyPending(false);
            break;
          case 'restartPermission':
            setPeer(previous => previous ? { ...previous, restartAllowed: msg.allowed } : previous);
            break;
          case 'restartResult':
            if (!msg.sent) {
              setRestartState(null);
              setDecoderError(t(locale, 'restartFailed'));
              setMobilePanel('actions');
              setMenuOpen(true);
            }
            break;
          case 'audioDenied':
            stopAudio();
            showSessionTip(t(locale, 'audioDenied'), true);
            break;
          case 'audioFormat':
            audioRef.current?.configure(msg.sampleRate, msg.channels);
            break;
          case 'audioFrame':
            audioRef.current?.push(msg.packet);
            break;
          case 'focusedDisplay':
            if (displayPrefsRef.current.followWindow && msg.display !== activeDisplay &&
                sessionDisplays.some(d => d.index === msg.display && d.online !== false)) {
              send({ type: 'switchDisplay', display: msg.display });
            }
            break;

          case 'display':
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
            break;

          case 'cursor': {
            const x = msg.x - cursorDisplayOrigin.x;
            const y = msg.y - cursorDisplayOrigin.y;
            const { width, height } = sizeRef.current;
            if (x >= 0 && x < width && y >= 0 && y < height) {
              placeCursor(x, y);
            } else if (cursorElRef.current) {
              cursorElRef.current.style.visibility = 'hidden';
            }
            break;
          }

          case 'resolutions':
            setResolutionOptions(msg);
            break;

          case 'cursorShape': {
            try {
              const shape = msg.shape;
              if (!shape) {
                setCursorShape(null);
                break;
              }
              const { width, height, hotX, hotY, rgba } = shape;
              const pixels = Uint8ClampedArray.from(atob(rgba), (char) => char.charCodeAt(0));
              setCursorShape({ pixels: new ImageData(pixels, width, height), hotX, hotY });
            } catch {
              setCursorShape(null);
            }
            break;
          }

          case 'clipboard':
            if (!displayPrefsRef.current.disableClipboard) {
              clipboard.receive(msg.text);
            }
            break;

          case 'rtt':
            setRtt(msg.ms);
            break;

          case 'pong': {
            setGatewayVideo(msg.gatewayVideo);
            const now = performance.now();
            diagStateRef.current = recordPongReceived(diagStateRef.current, msg.seq, now);
            setDiagSummary(computeDiagnosticsSummary(diagStateRef.current, now, PING_TIMEOUT_MS));
            break;
          }

          case 'error':
            setDecoderError(msg.message);
            setStatusDetail(null, msg.message);
            if (phaseRef.current === 'connecting') {
              if (/password|token|two.factor/i.test(msg.message)) setRestartState(null);
              receivedTerminalError = true;
              phaseRef.current = 'error';
              setPhase('error');
              setConnectDialog(true);
            }
            break;

          default:
            break;
        }
      };

      sock.onerror = () => {
        if (wsRef.current !== sock || receivedTerminalError) return;
        phaseRef.current = 'error';
        setPhase('error');
        setConnectDialog(true);
        setStatusDetail('detailGatewayError');
      };

      sock.onclose = () => {
        if (wsRef.current !== sock) return;
        wsRef.current = null;
        if (receivedTerminalError || phaseRef.current === 'error') {
          return;
        }
        if (phaseRef.current === 'connecting') {
          phaseRef.current = 'error';
          setPhase('error');
          setConnectDialog(true);
          setStatusDetail('detailGatewayClosed');
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
    connectGeneration.current++;
    setWebRtcFallbackReason(null);
    reconnectRequest.current = null;
    setRestartState(null);
    finishPendingClick();
    clearLongPress();
    if (phaseRef.current === 'live' && displayPrefsRef.current.lockAfterSessionEnd) {
      send({ type: 'key', action: 'down', control: 'LockScreen' });
      send({ type: 'key', action: 'up', control: 'LockScreen' });
    }
    send({ type: 'disconnect' });
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    decoderRef.current?.close();
    setMenuOpen(false);
    setToolbarExpanded(false);
    setConnectDialog(false);
    setSoftKeys(false);
    resetDiagnostics();
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

  // Helper: map stage client coords to remote coords
  const stageLocalPoint = useCallback((clientX: number, clientY: number) => {
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return { x: clientX, y: clientY };

    return { x: clientX - rect.left, y: clientY - rect.top };
  }, []);

  const remoteFromLocal = useCallback(
    (localX: number, localY: number) =>
      mapToRemote(localX, localY, remoteW, remoteH, viewRef.current),
    [remoteW, remoteH],
  );

  const remoteFromLocalClamped = useCallback(
    (localX: number, localY: number) =>
      mapToRemoteClamped(localX, localY, remoteW, remoteH, viewRef.current),
    [remoteW, remoteH],
  );

  const syncGestureDebug = useCallback((state: TouchGestureState) => {
    if (window.__rd) {
      window.__rd.gesturePhase = state.phase;
      window.__rd.activePointers = state.pointers.size;
    }
  }, []);

  const runTouchEffectsRef = useRef<(effects: TouchGestureEffect[]) => void>(() => {});

  const runTouchEffects = useCallback(
    (effects: TouchGestureEffect[]) => {
      for (const ef of effects) {
        switch (ef.type) {
          case 'cancel-long-press':
            clearLongPress();
            break;
          case 'arm-long-press': {
            clearLongPress();
            const targetId = ef.pointerId;
            longTimerRef.current = window.setTimeout(() => {
              longTimerRef.current = null;
              const next = gestureLongPressTimeout(touchGestureRef.current, targetId);
              touchGestureRef.current = next.state;
              syncGestureDebug(next.state);
              runTouchEffectsRef.current(next.effects);
            }, LONG_PRESS_MS);
            break;
          }
          case 'long-press': {
            if (!remoteInputRef.current || displayPrefsRef.current.viewOnly) break;
            const pos = touchModeRef.current
              ? remoteFromLocal(ef.x, ef.y)
              : cursorPoint();
            if (pos) {
              clickButton('right', pos.x, pos.y);
            }
            break;
          }
          case 'start-drag-lock': {
            if (!remoteInputRef.current || displayPrefsRef.current.viewOnly) break;
            finishPendingClick();
            const pt = cursorPoint();
            send({ type: 'mouse', action: 'move', x: pt.x, y: pt.y });
            send({ type: 'mouse', action: 'down', button: 'left', x: pt.x, y: pt.y });
            break;
          }
          case 'start-touch-drag': {
            if (!remoteInputRef.current || displayPrefsRef.current.viewOnly) break;
            finishPendingClick();
            const startPos = remoteFromLocalClamped(ef.x, ef.y);
            if (startPos) {
              placeCursor(startPos.x, startPos.y);
              send({ type: 'mouse', action: 'move', x: startPos.x, y: startPos.y });
              send({ type: 'mouse', action: 'down', button: 'left', x: startPos.x, y: startPos.y });
            }
            break;
          }
          case 'move-touch-drag': {
            if (!remoteInputRef.current || displayPrefsRef.current.viewOnly) break;
            const curPos = remoteFromLocalClamped(ef.x, ef.y);
            if (curPos) {
              placeCursor(curPos.x, curPos.y);
              queueMove(curPos);
            }
            break;
          }
          case 'end-drag':
          case 'release-stuck-drag': {
            flushMove();
            if (displayPrefsRef.current.viewOnly) break;
            const pos = touchModeRef.current
              ? remoteFromLocalClamped(ef.x, ef.y)
              : cursorPoint();
            if (pos) {
              send({ type: 'mouse', action: 'up', button: 'left', x: pos.x, y: pos.y });
            }
            break;
          }
          case 'cursor-move': {
            const scale = Math.max(0.01, viewRef.current.scale);
            placeCursor(cursorRef.current.x + ef.dx / scale, cursorRef.current.y + ef.dy / scale);
            if (remoteInputRef.current && !displayPrefsRef.current.viewOnly) {
              queueMove(cursorPoint());
            }
            break;
          }
          case 'tap-click': {
            if (!remoteInputRef.current) break;
            if (isTouchLayout && chromeRef.current.menu) closeChrome();
            if (displayPrefsRef.current.viewOnly) break;
            const pos = touchModeRef.current
              ? remoteFromLocal(ef.x, ef.y)
              : cursorPoint();
            if (pos) {
              const atCursor = Math.hypot(pos.x - cursorRef.current.x, pos.y - cursorRef.current.y) <= 8;
              clickButton('left', pos.x, pos.y);
              if (!displayPrefsRef.current.swapMouseButtons &&
                  atCursor && textCursor && !softKeys) openSoftKeyboard();
            }
            break;
          }
          case 'two-finger-tap': {
            if (!remoteInputRef.current || displayPrefsRef.current.viewOnly) break;
            const pos = touchModeRef.current
              ? remoteFromLocal(ef.x, ef.y)
              : cursorPoint();
            if (pos) {
              clickButton('right', pos.x, pos.y);
            }
            break;
          }
          case 'pan':
            panBy(ef.dx, ef.dy);
            break;
          case 'pinch':
            applyPinchStepRef.current(
              ef.prevMidX,
              ef.prevMidY,
              ef.prevDist,
              ef.nextMidX,
              ef.nextMidY,
              ef.nextDist,
            );
            break;
          case 'three-finger-scroll': {
            if (!remoteInputRef.current || displayPrefsRef.current.viewOnly) break;
            const clamped = Math.max(
              -MAX_WHEEL_TICKS_PER_EVENT,
              Math.min(MAX_WHEEL_TICKS_PER_EVENT, ef.ticks),
            );
            const dir = applyWheelDirection(clamped, displayPrefsRef.current.reverseMouseWheel);
            if (dir !== 0) {
              send({ type: 'mouse', action: 'wheel', x: 0, y: dir });
            }
            break;
          }
        }
      }
    },
    [
      openSoftKeyboard,
      softKeys,
      textCursor,
      clearLongPress,
      clickButton,
      closeChrome,
      cursorPoint,
      finishPendingClick,
      flushMove,
      isTouchLayout,
      panBy,
      placeCursor,
      queueMove,
      remoteFromLocal,
      remoteFromLocalClamped,
      send,
      syncGestureDebug,
    ],
  );
  runTouchEffectsRef.current = runTouchEffects;

  const resetAllGestures = useCallback(() => {
    if (zeroTouchTimerRef.current !== null) {
      window.clearTimeout(zeroTouchTimerRef.current);
      zeroTouchTimerRef.current = null;
    }
    nativeScrollRef.current = null;
    touchFallbackPinchRef.current = null;
    wheelAccumRef.current = { x: 0, y: 0 };

    const next = resetTouchGestureState(touchGestureRef.current);
    touchGestureRef.current = next.state;
    syncGestureDebug(next.state);
    runTouchEffectsRef.current(next.effects);

    const drag = desktopDragRef.current;
    if (drag) {
      desktopDragRef.current = null;
      if (drag.mode === 'remote' && !displayPrefsRef.current.viewOnly) {
        cancelQueuedMove();
        const pos = remoteFromLocalClamped(drag.lastX, drag.lastY);
        if (pos) {
          send({ type: 'mouse', action: 'up', button: drag.button, x: pos.x, y: pos.y });
        }
      }
    }
  }, [cancelQueuedMove, remoteFromLocalClamped, send, syncGestureDebug]);

  const resetAllGesturesRef = useRef(resetAllGestures);
  resetAllGesturesRef.current = resetAllGestures;

  // Cleanly reset active gestures whenever remote input pauses (menu/dialog/disconnect) or mode switches
  useEffect(() => {
    if (!remoteInput) {
      resetAllGestures();
    }
  }, [remoteInput, resetAllGestures]);

  useEffect(() => {
    resetAllGestures();
  }, [touchMode, resetAllGestures]);

  // Pointer handlers on stage
  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (!remoteInput) return;
    // Ignore events originating from interactive overlays/chrome inside the stage
    if (e.target !== stageRef.current && e.target !== canvasRef.current) return;

    if (toolbarExpanded && !toolbarPinned) {
      setToolbarExpanded(false);
    }

    const isTouch = e.pointerType === 'touch';
    // Ignore browser-synthesized compatibility mouse events right after touch
    if (!isTouch && Date.now() - lastTouchAtRef.current < 450) {
      return;
    }

    if (isTouch && nativeScrollRef.current) return;
    const local = stageLocalPoint(e.clientX, e.clientY);

    if (!isTouch) {
      // Desktop mouse interaction
      setVirtualCursorVisible(false);

      // Middle-button drag or Alt+LeftDrag pans the viewport
      const shouldPan = e.button === 1 || (e.button === 0 && e.altKey);
      if (shouldPan) {
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Ignore NotFoundError on synthetic or already-lifted pointers
        }
        desktopDragRef.current = {
          pointerId: e.pointerId,
          mode: 'pan',
          button: 'left',
          lastX: local.x,
          lastY: local.y,
        };
        return;
      }

      if (displayPrefsRef.current.viewOnly) return;

      const pos = remoteFromLocal(local.x, local.y);
      if (!pos) return;
      const rawBtn = e.button === 2 ? 'right' : 'left';
      const btn = applyMouseButtonSwap(rawBtn, displayPrefsRef.current.swapMouseButtons);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ignore NotFoundError on synthetic or already-lifted pointers
      }
      desktopDragRef.current = {
        pointerId: e.pointerId,
        mode: 'remote',
        button: btn,
        lastX: local.x,
        lastY: local.y,
      };
      // Arm hidden capture input on desktop clicks so OS IME (Chinese/CJK) works smoothly in remote input boxes
      focusDesktopCapture();
      // Always cancel stale rAF moves and sync cursor position BEFORE mouse down so window drags hit the exact titlebar
      cancelQueuedMove();
      send({ type: 'mouse', action: 'move', x: pos.x, y: pos.y });
      send({ type: 'mouse', action: 'down', button: btn, x: pos.x, y: pos.y });
      return;
    }

    // Touch interaction driven strictly by deterministic TouchGestureState FSM
    e.preventDefault();
    const now = Date.now();
    lastTouchAtRef.current = now;
    if (zeroTouchTimerRef.current !== null) {
      window.clearTimeout(zeroTouchTimerRef.current);
      zeroTouchTimerRef.current = null;
    }
    if (!touchMode) {
      setVirtualCursorVisible(true);
    }

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Ignore NotFoundError on synthetic or rapid multi-touch pointers
    }

    const liveTouchCount =
      now - nativeTouchInfoRef.current.updatedAt <= 120
        ? nativeTouchInfoRef.current.count
        : null;

    const next = gesturePointerDown(touchGestureRef.current, e.pointerId, local.x, local.y, {
      mode: touchMode ? 'touch' : 'mouse',
      hand: false,
      now,
      isPrimary: e.isPrimary,
      liveTouchCount,
    });
    touchGestureRef.current = next.state;
    syncGestureDebug(next.state);
    runTouchEffects(next.effects);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!remoteInput) return;

    const isTouch = e.pointerType === 'touch';
    if (!isTouch && Date.now() - lastTouchAtRef.current < 450) {
      return;
    }

    if (isTouch && nativeScrollRef.current) return;
    const local = stageLocalPoint(e.clientX, e.clientY);

    if (!isTouch) {
      const drag = desktopDragRef.current;
      if (drag && drag.pointerId === e.pointerId && drag.mode === 'pan') {
        const dx = local.x - drag.lastX;
        const dy = local.y - drag.lastY;
        drag.lastX = local.x;
        drag.lastY = local.y;
        panBy(dx, dy);
        return;
      }

      if (displayPrefsRef.current.viewOnly) return;
      if (isTouchLayout && !drag && e.target !== stageRef.current && e.target !== canvasRef.current) return;

      const isRemoteDrag = Boolean(drag && drag.pointerId === e.pointerId && drag.mode === 'remote');
      if (isRemoteDrag && drag) {
        drag.lastX = local.x;
        drag.lastY = local.y;
      }
      const pos = isRemoteDrag
        ? remoteFromLocalClamped(local.x, local.y)
        : remoteFromLocal(local.x, local.y);
      if (pos) {
        if (isRemoteDrag) {
          cancelQueuedMove();
          send({ type: 'mouse', action: 'move', x: pos.x, y: pos.y });
        } else {
          queueMove(pos);
        }
      }
      return;
    }

    if (!touchGestureRef.current.pointers.has(e.pointerId)) return;
    const now = Date.now();
    lastTouchAtRef.current = now;

    const next = gesturePointerMove(touchGestureRef.current, e.pointerId, local.x, local.y, {
      mode: touchMode ? 'touch' : 'mouse',
      now,
    });
    touchGestureRef.current = next.state;
    syncGestureDebug(next.state);
    runTouchEffects(next.effects);
  };

  const handlePointerUpOrCancel = (e: React.PointerEvent<HTMLElement>) => {
    const isTouch = e.pointerType === 'touch';
    if (!isTouch && Date.now() - lastTouchAtRef.current < 450) {
      return;
    }

    if (isTouch && nativeScrollRef.current) return;
    const local = stageLocalPoint(e.clientX, e.clientY);

    if (!isTouch) {
      const drag = desktopDragRef.current;
      if (drag && drag.pointerId === e.pointerId) {
        desktopDragRef.current = null;
        if (drag.mode === 'remote' && !displayPrefsRef.current.viewOnly) {
          cancelQueuedMove();
          const pos = remoteFromLocalClamped(local.x, local.y);
          if (pos) {
            send({ type: 'mouse', action: 'move', x: pos.x, y: pos.y });
            send({ type: 'mouse', action: 'up', button: drag.button, x: pos.x, y: pos.y });
          }
        }
      }
      return;
    }

    // Untracked pointer IDs (e.g. pointerup bubbling from MobileDock / SessionHandle / SoftKeyboardBar) are ignored
    if (!touchGestureRef.current.pointers.has(e.pointerId)) return;

    const now = Date.now();
    lastTouchAtRef.current = now;
    const kind: 'up' | 'cancel' = e.type === 'pointerup' ? 'up' : 'cancel';

    const next = gesturePointerUpOrCancel(
      touchGestureRef.current,
      e.pointerId,
      local.x,
      local.y,
      kind,
      { now },
    );
    touchGestureRef.current = next.state;
    syncGestureDebug(next.state);
    runTouchEffects(next.effects);
  };

  const handleLostPointerCapture = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') {
      if (!touchGestureRef.current.pointers.has(e.pointerId)) return;
      const local = stageLocalPoint(e.clientX, e.clientY);
      const next = gesturePointerUpOrCancel(
        touchGestureRef.current,
        e.pointerId,
        local.x,
        local.y,
        'cancel',
        { now: Date.now() },
      );
      touchGestureRef.current = next.state;
      syncGestureDebug(next.state);
      runTouchEffects(next.effects);
      return;
    }

    const drag = desktopDragRef.current;
    if (drag && drag.pointerId === e.pointerId) {
      desktopDragRef.current = null;
      if (drag.mode === 'remote' && !displayPrefsRef.current.viewOnly) {
        cancelQueuedMove();
        const pos = remoteFromLocalClamped(drag.lastX, drag.lastY);
        if (pos) {
          send({ type: 'mouse', action: 'up', button: drag.button, x: pos.x, y: pos.y });
        }
      }
    }
  };

  // Step-2 pinch-zoom isolation on the remote stage:
  // Non-passive touch, iOS gesturestart/gesturechange/gestureend, and Ctrl+wheel handlers
  // keep browser-level page zoom from hijacking remote desktop gestures.
  const wheelHandlerRef = useRef<(e: WheelEvent) => void>(() => {});
  wheelHandlerRef.current = (e: WheelEvent) => {
    if (!remoteInput) return;
    e.preventDefault();
    const local = stageLocalPoint(e.clientX, e.clientY);

    if (e.ctrlKey || e.altKey || e.metaKey) {
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      setScaleAround(viewRef.current.scale * factor, local.x, local.y);
      return;
    }

    if (displayPrefsRef.current.viewOnly) return;

    const pos = remoteFromLocal(local.x, local.y);
    if (pos) {
      cancelQueuedMove();
      send({ type: 'mouse', action: 'move', x: pos.x, y: pos.y });
    }

    const { tx, ty, nextAccumX, nextAccumY } = accumulateWheelTicks(
      e.deltaX,
      e.deltaY,
      e.deltaMode,
      wheelAccumRef.current.x,
      wheelAccumRef.current.y,
      displayPrefsRef.current.reverseMouseWheel,
    );
    wheelAccumRef.current = { x: nextAccumX, y: nextAccumY };

    if (tx !== 0 || ty !== 0) {
      send({ type: 'mouse', action: 'wheel', x: tx, y: ty });
    }
  };

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    const isStageSurface = (target: EventTarget | null): boolean =>
      target === el || target === canvasRef.current;

    const isInsideScrollableChrome = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest('[data-testid="connection-panel"]') ||
          target.closest('[data-testid="session-menu"]') ||
          target.closest('[data-testid="softbar"]') ||
          target.closest('[data-testid="diagnostic-overlay"]') ||
          target.closest('.remote-tools, .remote-capsule, [data-adaptive-select], [data-session-notice]'),
      );
    };

    const onGesture = (e: Event) => {
      if (isStageSurface(e.target)) {
        e.preventDefault();
      }
    };

    const touchPairMetrics = (touches: Touch[]) => {
      const { x: x0, y: y0 } = stageLocalPoint(touches[0].clientX, touches[0].clientY);
      const { x: x1, y: y1 } = stageLocalPoint(touches[1].clientX, touches[1].clientY);
      return {
        midX: (x0 + x1) / 2,
        midY: (y0 + y1) / 2,
        dist: Math.hypot(x1 - x0, y1 - y0),
      };
    };

    // TouchList remains authoritative when a browser omits one of the pointer events.
    // Once three fingers take over, suppress pointer gestures until every finger lifts.
    const handleNativeScroll = (points: Touch[], moving: boolean) => {
      if (!nativeScrollRef.current && points.length < 3) return false;
      const x = points.reduce((sum, point) => sum + point.clientX, 0) / points.length;
      const y = points.reduce((sum, point) => sum + point.clientY, 0) / points.length;
      let scroll = nativeScrollRef.current;
      if (!scroll) {
        resetAllGesturesRef.current();
        scroll = { x, anchorY: y, y, remainder: 0, count: points.length };
        nativeScrollRef.current = scroll;
      }
      if (moving && points.length >= 3 && scroll.count === points.length) {
        const { ticks, remainder } = consumeThreeFingerScroll(scroll.remainder + y - scroll.y);
        scroll.remainder = remainder;
        if (ticks && remoteInputRef.current && !displayPrefsRef.current.viewOnly) {
          const local = stageLocalPoint(scroll.x, scroll.anchorY);
          const pos = touchModeRef.current ? remoteFromLocalClamped(local.x, local.y) : cursorPoint();
          if (pos) {
            cancelQueuedMove();
            send({ type: 'mouse', action: 'move', x: pos.x, y: pos.y });
            runTouchEffectsRef.current([{ type: 'three-finger-scroll', ticks }]);
          }
        }
      } else {
        scroll.remainder = 0;
      }
      scroll.y = y;
      scroll.count = points.length;
      return true;
    };

    const shouldUseTouchFallback = (touches: Touch[]) =>
      touches.length === 2 && touchGestureRef.current.pointers.size < 2;

    const onTouchStart = (e: TouchEvent) => {
      if (!remoteInputRef.current && e.touches.length > 1) e.preventDefault();
      if (!Array.from(e.changedTouches).some(touch => isStageSurface(touch.target))) return;
      const touches = Array.from(e.touches).filter(touch => isStageSurface(touch.target));
      const now = Date.now();
      nativeTouchInfoRef.current = { count: touches.length, updatedAt: now };
      if (zeroTouchTimerRef.current !== null) {
        window.clearTimeout(zeroTouchTimerRef.current);
        zeroTouchTimerRef.current = null;
      }

      if (shouldPreventStageTouch(remoteInputRef.current, isStageSurface(e.target))) {
        e.preventDefault();
        if (handleNativeScroll(touches, false)) return;
        touchFallbackPinchRef.current = shouldUseTouchFallback(touches)
          ? touchPairMetrics(touches)
          : null;
      }
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!remoteInputRef.current && e.touches.length > 1) e.preventDefault();
      if (!Array.from(e.changedTouches).some(touch => isStageSurface(touch.target))) return;
      const touches = Array.from(e.touches).filter(touch => isStageSurface(touch.target));
      const now = Date.now();
      nativeTouchInfoRef.current = { count: touches.length, updatedAt: now };
      if (shouldPreventStageTouch(remoteInputRef.current, isStageSurface(e.target))) {
        e.preventDefault();
        if (handleNativeScroll(touches, true)) return;
        if (!shouldUseTouchFallback(touches)) {
          touchFallbackPinchRef.current = null;
          return;
        }

        const cur = touchPairMetrics(touches);
        const prev = touchFallbackPinchRef.current;
        if (touchGestureRef.current.pointers.size === 1) {
          // A partial pointer sequence must not also become a tap or long press.
          resetAllGesturesRef.current();
        }
        touchFallbackPinchRef.current = cur;
        if (prev) {
          applyPinchStepRef.current(prev.midX, prev.midY, prev.dist, cur.midX, cur.midY, cur.dist);
        }
      }
    };

    const onTouchEndOrCancel = (e: TouchEvent) => {
      if (!Array.from(e.changedTouches).some(touch => isStageSurface(touch.target))) return;
      const touches = Array.from(e.touches).filter(touch => isStageSurface(touch.target));
      const now = Date.now();
      nativeTouchInfoRef.current = { count: touches.length, updatedAt: now };
      if (nativeScrollRef.current) {
        if (touches.length === 0) resetAllGesturesRef.current();
        else handleNativeScroll(touches, false);
        return;
      }
      if (touches.length < 2) {
        touchFallbackPinchRef.current = null;
      }
      // Authoritative zombie-pointer recovery: if OS reports 0 fingers on screen while
      // tracked pointers remain (missed pointerup/pointercancel), sweep back to 'idle' safely.
      if (touches.length === 0 && touchGestureRef.current.pointers.size > 0) {
        if (zeroTouchTimerRef.current !== null) {
          window.clearTimeout(zeroTouchTimerRef.current);
        }
        const delay = e.type === 'touchcancel' ? 0 : 60;
        zeroTouchTimerRef.current = window.setTimeout(() => {
          zeroTouchTimerRef.current = null;
          if (
            nativeTouchInfoRef.current.count === 0 &&
            touchGestureRef.current.pointers.size > 0
          ) {
            resetAllGesturesRef.current();
          }
        }, delay);
      }
    };

    const onWindowBlur = () => {
      resetAllGesturesRef.current();
    };

    const onVisibilityChange = () => {
      if (document.hidden) {
        resetAllGesturesRef.current();
      }
    };

    const onWheelNative = (e: WheelEvent) => {
      if (remoteInputRef.current && !isInsideScrollableChrome(e.target)) {
        wheelHandlerRef.current(e);
      }
    };

    const onWindowWheel = (e: WheelEvent) => {
      if (shouldPreventWindowWheel(remoteInputRef.current, isInsideScrollableChrome(e.target))) {
        e.preventDefault();
      }
    };

    const onWindowAuxOrNavMouse = (e: MouseEvent) => {
      if (
        remoteInputRef.current &&
        isBrowserNavOrAuxButton(e.button) &&
        !isInsideScrollableChrome(e.target)
      ) {
        e.preventDefault();
      }
    };

    const onWindowDragOrSelect = (e: Event) => {
      if (remoteInputRef.current && !isInsideScrollableChrome(e.target)) {
        e.preventDefault();
      }
    };

    el.addEventListener('gesturestart', onGesture, { passive: false });
    el.addEventListener('gesturechange', onGesture, { passive: false });
    el.addEventListener('gestureend', onGesture, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: false });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEndOrCancel, { passive: true });
    el.addEventListener('touchcancel', onTouchEndOrCancel, { passive: true });
    el.addEventListener('wheel', onWheelNative, { passive: false });
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('wheel', onWindowWheel, { passive: false, capture: true });
    window.addEventListener('mousedown', onWindowAuxOrNavMouse, true);
    window.addEventListener('auxclick', onWindowAuxOrNavMouse, true);
    window.addEventListener('dragstart', onWindowDragOrSelect, true);
    window.addEventListener('selectstart', onWindowDragOrSelect, true);

    return () => {
      if (zeroTouchTimerRef.current !== null) {
        window.clearTimeout(zeroTouchTimerRef.current);
        zeroTouchTimerRef.current = null;
      }
      el.removeEventListener('gesturestart', onGesture);
      el.removeEventListener('gesturechange', onGesture);
      el.removeEventListener('gestureend', onGesture);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEndOrCancel);
      el.removeEventListener('touchcancel', onTouchEndOrCancel);
      el.removeEventListener('wheel', onWheelNative);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('wheel', onWindowWheel, { capture: true });
      window.removeEventListener('mousedown', onWindowAuxOrNavMouse, true);
      window.removeEventListener('auxclick', onWindowAuxOrNavMouse, true);
      window.removeEventListener('dragstart', onWindowDragOrSelect, true);
      window.removeEventListener('selectstart', onWindowDragOrSelect, true);
    };
  }, []);

  const handleToggleTouchMode = () => {
    setTouchMode((prev) => {
      const next = !prev;
      if (!next) {
        setVirtualCursorVisible(
          isCoarseDevice || isMobileViewport || Date.now() - lastTouchAtRef.current < 60_000,
        );
      } else {
        setVirtualCursorVisible(false);
      }
      return next;
    });
  };

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
    <section
      ref={stageRef}
      className="stage"
      style={phase === 'live' && stageViewport ? {
        position: 'fixed', inset: 'auto', left: stageViewport.left, top: stageViewport.top,
        width: stageViewport.width, height: stageViewport.height,
      } : undefined}
      data-testid="stage"
      data-keyboard-avoiding={keyboardLayout.viewport ? 'true' : undefined}
      data-remote-active={remoteInput ? 'true' : 'false'}
      data-scroll-style={displayPrefs.scrollStyle}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUpOrCancel}
      onPointerCancel={handlePointerUpOrCancel}
      onLostPointerCapture={handleLostPointerCapture}
      onContextMenu={(e) => {
        if (remoteInput || e.target === stageRef.current || e.target === canvasRef.current) {
          e.preventDefault();
        }
      }}
    >
      <canvas
        ref={canvasRef}
        data-testid="canvas"
        width={remoteW}
        height={remoteH}
        style={{
          left: `${view.panX}px`,
          top: `${view.panY}px`,
          width: `${remoteW * view.scale}px`,
          height: `${remoteH * view.scale}px`,
        }}
      />

      <div
        ref={cursorElRef}
        className="remote-cursor"
        style={displayPrefs.enlargeCursor ? { transform: 'scale(2)', transformOrigin: '0 0' } : undefined}
        data-testid="remote-cursor"
        hidden={!showRemoteCursor}
        aria-hidden="true"
      >
        {cursorShape ? (
          <canvas
            ref={cursorCanvasRef}
            width={cursorShape.pixels.width}
            height={cursorShape.pixels.height}
            style={{ left: -cursorShape.hotX, top: -cursorShape.hotY }}
          />
        ) : (
          <MousePointer2 size={18} fill="#fff" stroke="#171717" />
        )}
      </div>

      <input
        ref={captureRef}
        type="text"
        className="capture"
        data-testid="capture"
        aria-hidden="true"
        tabIndex={-1}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onCompositionStart={() => {
          captureComposingRef.current = true;
        }}
        onCompositionEnd={(e) => {
          captureComposingRef.current = false;
          lastCompositionEndAtRef.current = performance.now();
          const committed = e.data || e.currentTarget.value;
          e.currentTarget.value = '';
          if (committed && !displayPrefsRef.current.viewOnly) {
            sendText(committed);
          }
        }}
        onInput={(e) => {
          if (captureComposingRef.current) return;
          const val = e.currentTarget.value;
          if (val) {
            e.currentTarget.value = '';
            if (!displayPrefsRef.current.viewOnly) {
              sendText(val);
            }
          }
        }}
      />

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
    </section>
  );
}
