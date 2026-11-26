import type { ErrorPayload } from '../shared/errors';
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
import { SessionPanels } from './components/SessionPanels';
import { RemoteAudio, type AudioFailureStage } from './lib/remoteAudio';
import type { MobilePanel } from './components/MobileSessionPanel';
import {
  type ConnectRequest,
  type ConnectionPhase,
} from './components/RustDeskShell';
import {
  type SavedDevice,
} from './lib/devices';
import {
  persistDisplayPrefs,
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
  const preferences = usePreferences(isCoarseDevice);
  const {
    setDirectIpEnabled, setMode, setPeerId, setIdServer, setRelayServer,
    setServerKey, setForceRelay, setHost, setPort,
    locale, displayPrefs, setDisplayPrefs, displayPrefsRef,
  } = preferences;
  const [password, setPassword] = useState('');
  const savedDevices = useSavedDevices();
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
  const [connectionError, setConnectionError] = useState<ErrorPayload>();
  const detail = detailKey ? t(locale, detailKey) : rawDetail;
  const setStatusDetail = useCallback((key: I18nKey | null, customText = '', error?: ErrorPayload) => {
    setConnectionError(error);
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

  const [quality, setQuality] = useState<QualityLevel>(displayPrefs.qualityPreset);
  const [targetFps, setTargetFps] = useState(displayPrefs.targetFps);
  const video = useVideoPipeline({ phase, send, targetFps,
    settingsKey: `${quality}:${displayPrefs.customBitrate}:${displayPrefs.codec}` });
  const { statsStore, videoLayout, decoderRef, sizeRef } = video;
  const [rtt, setRtt] = useState(0);
  const [gatewayVideo, setGatewayVideo] = useState<Extract<ServerMessage, { type: 'pong' }>['gatewayVideo']>();
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
  const viewport = useViewTransform({
    initialViewStyle: displayPrefs.viewStyle,
    isCoarseDevice,
    phase,
    softKeys,
    softKeyboardMode,
    stageRef,
    sizeRef,
    stats: videoLayout,
    cursorRef,
    lastInputPointRef,
    followCursorRef,
    onSystemDismiss: () => hideSoftKeyboard(),
  });

  const { setViewMode, setZoom, setPan, box, remoteW, remoteH, keyboardLayout, view, visibleViewport } = viewport;

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
    const fail = (stage: AudioFailureStage, error: unknown) => {
      if (socket !== wsRef.current || (player && player !== audioRef.current)) return;
      stopAudio();
      console.error('Remote audio failure', { stage, error });
      const messages = { start: 'audioStartFailed', module: 'audioModuleFailed',
        decode: 'audioDecodeFailed', playback: 'audioFailed' } as const;
      showSessionTip(t(locale, messages[stage]), true);
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
    } catch (error) {
      fail('start', error);
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

  const pointer = useRemotePointer({
    ...viewport,
    isCoarseDevice,
    touchMode: preferences.touchMode,
    setTouchMode: preferences.setTouchMode,
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

  const { touchMode, virtualCursorVisible, touchGestureRef, moveRafRef, finishPendingClick, clearLongPress } = pointer;

  // Keep diagnostics current without making telemetry rerender the desktop.
  useEffect(() => {
    const update = () => {
      const stats = statsStore.getSnapshot();
      window.__rd = {
        state: phase,
        codec: stats.codec,
        width: stats.width,
        height: stats.height,
        fps: stats.fps,
        delayMs: rtt || stats.delayMs,
        bitrate: stats.bitrate,
        decoded: stats.decoded,
        rxFps: stats.rxFps,
        renderFps: stats.renderFps,
        inFlightFrames: stats.inFlightFrames ?? 0,
        oldestFrameAgeMs: stats.oldestFrameAgeMs ?? 0,
        decodeLatencyMs: stats.decodeLatencyMs ?? 0,
        effectiveFps: stats.effectiveFps ?? 0,
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
    };
    update();
    return statsStore.subscribe(update);
  }, [phase, statsStore, rtt, touchMode, view.scale, view.panX, view.panY, box.w, box.h, diagSummary]);

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

  const gateway = useGatewaySession({
    ...preferences,
    ...savedDevices,
    ...video,
    ...viewport,
    ...pointer,
    reconnectRequest,
    phaseRef,
    cursorElRef,
    audioRef,
    diagStateRef,
    setWebRtcFallbackReason,
    setRestartState,
    setPhase,
    setConnectDialog,
    setMenuOpen,
    setAuthRequired,
    setPeer,
    setDisplay,
    setCursorEmbedded,
    setPrivacyPending,
    setPrivacyEnabled,
    setMobilePanel,
    setResolutionOptions,
    setCursorShape,
    setRtt,
    setGatewayVideo,
    setDiagSummary,
    setStatusDetail,
    focusDesktopCapture,
    showSessionTip,
    stopAudio,
    send,
    clipboard,
    password,
    webRtcEnabled,
    setWebRtcEnabled,
    phase,
    peer,
    restartState,
    restartDeadline,
    connectGeneration,
    wsRef,
    canvasRef,
    lastInputPointRef,
    emptyStats: EMPTY_STATS,
    setQuality,
    setTargetFps,
    setSoftKeys,
    setToolbarExpanded,
    resetDiagnostics,
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
          patch.targetFps !== undefined ||
          patch.codec !== undefined
        ) {
          const nextQ = next.qualityPreset;
          const nextFps = next.targetFps;
          setQuality(nextQ);
          setTargetFps(nextFps);
          send({ type: 'quality', quality: nextQ,
            customQuality: nextQ === 'custom' ? next.customBitrate : undefined,
            fps: nextFps, codec: next.codec });
        }

        if (patch.lockAfterSessionEnd !== undefined) {
          send({ type: 'lockAfterSessionEnd', enabled: next.lockAfterSessionEnd });
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

  const keyboard = useRemoteKeyboard({
    send,
    closeChrome,
    chromeRef,
    phaseRef,
    displayPrefsRef,
    shortcutModifier,
    showCtrlAltDel,
  });

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
      pointer={pointer}
      canvas={{ canvasRef, remoteW, remoteH, view }}
      cursor={{ cursorElRef, cursorCanvasRef, cursorShape, showRemoteCursor, enlargeCursor: displayPrefs.enlargeCursor }}
      capture={{ ...keyboard, captureRef, displayPrefsRef }}
    >
      <SessionPanels
        preferences={preferences}
        savedDevices={savedDevices}
        viewport={viewport}
        video={video}
        keyboard={keyboard}
        pointer={pointer}
        gateway={gateway}
        clipboard={clipboard}
        connection={{ phase, detail, connectionError, peer, password, setPassword, authRequired, handleSelectDevice, handleUpdateDisplayPrefs }}
        controls={{ send, display, setDisplay, resolutionOptions, quality, setQuality, targetFps, setTargetFps,
          privacyEnabled, privacyPending, setPrivacyPending, clipboardSync, clipboardAllowed, toggleClipboardSync,
          audioEnabled, toggleAudio, showCtrlAltDel }}
        chrome={{ handleX, setHandleX, toolbarExpanded, setToolbarExpanded, toolbarPinned, setToolbarPinned,
          mobilePanel, setMobilePanel, menuOpen, setMenuOpen, connectDialog, setConnectDialog,
          softKeys, softKeyboardMode, softKeyboardInputRef, closeChrome, toggleSoftKeyboard, switchSoftKeyboard,
          hideSoftKeyboard, isMobileViewport, isCoarseDevice, isTouchLayout, remoteInput }}
        notices={{ restartState, setRestartState, sessionTip, showSessionTip, webRtcFallbackReason, setWebRtcFallbackReason }}
        diagnostics={{ diagnosticsOpen, setDiagnosticsOpen, diagSummary, rtt, gatewayVideo }}
      />
    </RemoteStage>
  );
}
