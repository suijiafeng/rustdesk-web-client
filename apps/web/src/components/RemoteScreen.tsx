// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react';
import type { ClientMessage, CursorShape, DisplayInfo, QualityLevel } from '@rustdesk-web/shared';
import { MousePointer2 } from 'lucide-react';
import { clampPan, computePinchStep, computeViewTransform, mapFromRemote, panToKeepVisible, type ViewMode, type ViewTransform } from '../lib/mapping.ts';
import type { DefaultViewStyle, ScrollStyle } from '../lib/displayPrefs.ts';
import {
  LONG_PRESS_MS,
  createTouchGestureState,
  gestureLongPressTimeout,
  gesturePointerDown,
  gesturePointerMove,
  gesturePointerUpOrCancel,
  type TouchGestureEffect,
} from '../lib/gestures.ts';
import { applyTouchEffects } from '../lib/touchInput.ts';
import { MobileSessionDock } from './MobileSessionDock.tsx';
import { SoftKeyboardBar } from './SoftKeyboardBar.tsx';
import { useKeyboardViewport } from '../hooks/useKeyboardViewport.ts';
import type { Locale } from '../lib/i18n.ts';
import { sessionChromeMode } from '../lib/sessionChrome.ts';
import { DiagnosticsPanel } from './DiagnosticsPanel.tsx';
import { offsetPointerMessages } from '../lib/displays.ts';
import { isImeEvent } from '../lib/keys.ts';
import { SessionToolbar } from './SessionToolbar.tsx';
import { ClipboardPanel } from './ClipboardPanel.tsx';
import {
  noteKeyDown,
  noteKeyUp,
  quickKeyMessages,
  releaseTrackedKeys,
  textMessages,
  type QuickKeyName,
  type TrackedKey,
} from '../lib/keyboard.ts';
import { adaptKeyMessages, classifyBrowser, classifyLocalOs, classifyRemoteOs, keyboardLockAction, readKeyboardLock, remoteFeatures } from '../lib/platform.ts';
import { shouldIsolateKeyboardEvent } from '../lib/inputIsolation.ts';
import {
  desktopPointerButton,
  pointerDownMessages,
  pointerMoveMessage,
  pointerUpMessages,
  releaseHeldButton,
  remotePoint,
  wheelMessages,
  type MouseButton,
} from '../lib/mouseInput.ts';

interface RemoteScreenProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  frameWidth: number;
  frameHeight: number;
  viewOnly: boolean;
  swapMouseButtons: boolean;
  reverseMouseWheel: boolean;
  showRemoteCursor: boolean;
  enlargeCursor: boolean;
  cursorEmbedded: boolean;
  displayOrigin: { x: number; y: number };
  cursor: { x: number; y: number } | null;
  cursorShape: CursorShape | null;
  onMouse: (messages: ClientMessage[]) => void;
  onKeyboard: (messages: ClientMessage[]) => void;
  onHeldRelease: (message: ClientMessage | null) => void;
  onArmKeys: (messages: ClientMessage[]) => void;
  onDisconnect: () => void;
  displays: readonly DisplayInfo[];
  currentDisplay: number;
  quality: QualityLevel;
  privacyAllowed: boolean;
  onSwitchDisplay: (display: number) => void;
  onQuality: (quality: QualityLevel) => void;
  onToggleViewOnly: () => void;
  audioEnabled: boolean;
  audioIssue: string;
  volume: number;
  onToggleAudio: () => void;
  onVolume: (volume: number) => void;
  diagnosticsOpen: boolean;
  stats: { startedAt: number; frames: number; bytes: number; rttMs: number | null };
  decodeError: string;
  linkQuality: {
    fps: number;
    bitrate: number;
    streamState: 'waiting' | 'active' | 'idle';
    browserRttMs: number | null;
    lossPct: number;
    linkHealth: 'waiting' | 'good' | 'fair' | 'poor';
  };
  onCopyDiagnostics: (text: string) => void;
  onToggleDiagnostics: () => void;
  remotePlatform: string;
  clipboardFallback: string | null;
  clipboardPermitted: boolean;
  clipboardDisabled: boolean;
  onSendClipboard: (text: string) => 'ok' | 'disabled' | 'denied' | 'empty' | 'too-large';
  onDismissClipboard: () => void;
  privacyEnabled: boolean;
  privacyPending: boolean;
  privacyFailed: boolean;
  onTogglePrivacy: () => void;
  resolutions: readonly { width: number; height: number }[];
  onResolution: (width: number, height: number) => void;
  restartAllowed: boolean;
  restartNotice: null | 'requested' | 'waiting' | 'failed' | 'ended';
  onRestart: () => void;
  viewStyle: DefaultViewStyle;
  scrollStyle: ScrollStyle;
  followRemoteCursor: boolean;
  autoKeyboard: boolean;
  locale?: Locale;
}

interface Drag {
  pointerId: number;
  button: MouseButton;
  point: { x: number; y: number };
}

export function RemoteScreen({
  canvasRef,
  frameWidth,
  frameHeight,
  viewOnly,
  swapMouseButtons,
  reverseMouseWheel,
  showRemoteCursor,
  enlargeCursor,
  cursorEmbedded,
  displayOrigin,
  cursor,
  cursorShape,
  onMouse,
  onKeyboard,
  onHeldRelease,
  onArmKeys,
  onDisconnect,
  displays,
  currentDisplay,
  quality,
  privacyAllowed,
  onSwitchDisplay,
  onQuality,
  onToggleViewOnly,
  audioEnabled,
  audioIssue,
  volume,
  onToggleAudio,
  onVolume,
  diagnosticsOpen,
  stats,
  decodeError,
  linkQuality,
  onCopyDiagnostics,
  onToggleDiagnostics,
  remotePlatform,
  clipboardFallback,
  clipboardPermitted,
  clipboardDisabled,
  onSendClipboard,
  onDismissClipboard,
  privacyEnabled,
  privacyPending,
  privacyFailed,
  onTogglePrivacy,
  resolutions,
  onResolution,
  restartAllowed,
  restartNotice,
  onRestart,
  viewStyle,
  scrollStyle,
  followRemoteCursor,
  autoKeyboard,
  locale = 'en',
}: RemoteScreenProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const trackedKeysRef = useRef<TrackedKey[]>([]);
  const composingRef = useRef(false);
  const compositionEndedAtRef = useRef(0);
  const dragRef = useRef<Drag | null>(null);
  const queuedMoveRef = useRef<{ x: number; y: number } | null>(null);
  const moveFrameRef = useRef<number | null>(null);
  const wheelAccumRef = useRef({ x: 0, y: 0 });
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [viewMode, setViewMode] = useState<ViewMode>(viewStyle === 'stretch' ? 'stretch' : viewStyle === 'original' ? 'original' : 'fit');
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ panX: 0, panY: 0 });
  const [touchMode, setTouchMode] = useState(true);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const [clipboardOpen, setClipboardOpen] = useState(false);
  const [coarsePointer, setCoarsePointer] = useState(() => window.matchMedia('(pointer: coarse)').matches);
  const [viewportNarrow, setViewportNarrow] = useState(() => window.matchMedia('(max-width: 768px)').matches);

  const viewOnlyRef = useRef(viewOnly);
  const swapRef = useRef(swapMouseButtons);
  const reverseRef = useRef(reverseMouseWheel);
  const frameRef = useRef({ width: frameWidth, height: frameHeight });
  const transformRef = useRef<ViewTransform>({ scale: 1, panX: 0, panY: 0 });
  const onMouseRef = useRef(onMouse);
  const onKeyboardRef = useRef(onKeyboard);
  const onHeldRef = useRef(onHeldRelease);
  const onArmKeysRef = useRef(onArmKeys);
  const originRef = useRef(displayOrigin);
  const boxRef = useRef(box);
  const gestureRef = useRef(createTouchGestureState());
  const longTimerRef = useRef<number | null>(null);
  const touchCursorRef = useRef({ x: 0, y: 0 });
  const touchModeRef = useRef(touchMode);
  const anchorRef = useRef({ x: 0, y: 0 });
  boxRef.current = box;
  touchModeRef.current = touchMode;
  viewOnlyRef.current = viewOnly;
  swapRef.current = swapMouseButtons;
  reverseRef.current = reverseMouseWheel;
  frameRef.current = { width: frameWidth, height: frameHeight };
  onMouseRef.current = onMouse;
  onKeyboardRef.current = onKeyboard;
  const localOsRef = useRef(classifyLocalOs(navigator.userAgent, navigator.platform));
  const remotePlatformRef = useRef(remotePlatform);
  remotePlatformRef.current = remotePlatform;
  const scrollStyleRef = useRef(scrollStyle);
  scrollStyleRef.current = scrollStyle;
  useEffect(() => {
    if (clipboardFallback) setClipboardOpen(true);
  }, [clipboardFallback]);
  useEffect(() => {
    setViewMode(viewStyle === 'stretch' ? 'stretch' : viewStyle === 'original' ? 'original' : 'fit');
  }, [viewStyle]);
  const sendKeys = useCallback((messages: ClientMessage[]) => {
    const adapted = adaptKeyMessages(messages, localOsRef.current, classifyRemoteOs(remotePlatform));
    if (adapted.length > 0) onKeyboard(adapted);
  }, [onKeyboard, remotePlatform]);
  const sendQuickKey = useCallback((name: QuickKeyName) => {
    const remote = classifyRemoteOs(remotePlatform);
    const features = remoteFeatures(remote);
    if (name === 'Ctrl+Alt+Del' && !features.ctrlAltDel) return;
    if (name === 'Lock' && !features.lockScreen) return;
    sendKeys(quickKeyMessages(name, viewOnly));
  }, [remotePlatform, sendKeys, viewOnly]);
  onHeldRef.current = onHeldRelease;
  onArmKeysRef.current = onArmKeys;
  originRef.current = displayOrigin;

  const sendPointer = (messages: ClientMessage[]) => {
    onMouseRef.current(offsetPointerMessages(messages, originRef.current));
  };
  const armPointer = (message: ClientMessage | null) => {
    if (!message) {
      onHeldRef.current(null);
      return;
    }
    onHeldRef.current(offsetPointerMessages([message], originRef.current)[0] ?? null);
  };

  const keyboardLayout = useKeyboardViewport({
    enabled: true,
    softKeys: keyboardOpen,
    stage: stageRef,
    read: () => ({
      mode: viewMode,
      zoom,
      view: transformRef.current,
      remoteW: frameRef.current.width,
      remoteH: frameRef.current.height,
      anchor: anchorRef.current,
    }),
    apply: (size, next) => {
      setBox({ width: size.w, height: size.h });
      setViewMode(next.mode);
      setZoom(Number.isFinite(next.zoom) && next.zoom > 0 ? next.zoom : 1);
      setPan({ panX: next.view.panX, panY: next.view.panY });
    },
  });

  const transform = computeViewTransform(box.width, box.height, frameWidth, frameHeight, viewMode, zoom, pan, {
    allowEdgePan: true,
    edgePadding: 48,
    bottomInset: keyboardOpen && !keyboardLayout.viewport ? 112 : 0,
  });
  transformRef.current = transform;

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      if (keyboardLayout.pending.current) return;
      setBox({ width: stage.clientWidth, height: stage.clientHeight });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)');
    const narrow = window.matchMedia('(max-width: 768px)');
    const apply = () => {
      setCoarsePointer(coarse.matches);
      setViewportNarrow(narrow.matches);
    };
    apply();
    coarse.addEventListener('change', apply);
    narrow.addEventListener('change', apply);
    return () => {
      coarse.removeEventListener('change', apply);
      narrow.removeEventListener('change', apply);
    };
  }, []);

  const showCursor = showRemoteCursor && !cursorEmbedded && cursor !== null && frameWidth > 0 && frameHeight > 0;

  useEffect(() => {
    const canvas = cursorCanvasRef.current;
    if (!canvas || !cursorShape || !showCursor) return;
    let bytes: Uint8ClampedArray;
    try {
      bytes = Uint8ClampedArray.from(atob(cursorShape.rgba), (char) => char.charCodeAt(0));
    } catch {
      return;
    }
    if (bytes.length !== cursorShape.width * cursorShape.height * 4) return;
    const image = new ImageData(cursorShape.width, cursorShape.height);
    image.data.set(bytes);
    canvas.getContext('2d')?.putImageData(image, 0, 0);
  }, [cursorShape, showCursor]);

  const cancelQueuedMove = () => {
    if (moveFrameRef.current !== null) cancelAnimationFrame(moveFrameRef.current);
    moveFrameRef.current = null;
    queuedMoveRef.current = null;
  };

  const queueMove = (point: { x: number; y: number }) => {
    queuedMoveRef.current = point;
    if (moveFrameRef.current !== null) return;
    moveFrameRef.current = requestAnimationFrame(() => {
      moveFrameRef.current = null;
      const next = queuedMoveRef.current;
      queuedMoveRef.current = null;
      if (!next) return;
      const message = pointerMoveMessage(next, viewOnlyRef.current);
      if (message) sendPointer([message]);
    });
  };

  const releaseDrag = (point: { x: number; y: number } | null) => {
    const drag = dragRef.current;
    dragRef.current = null;
    armPointer(null);
    if (!drag || viewOnlyRef.current) return;
    cancelQueuedMove();
    sendPointer(releaseHeldButton(drag.button, point ?? drag.point));
  };

  useEffect(() => {
    const onBlur = () => releaseDrag(dragRef.current?.point ?? null);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('blur', onBlur);
      cancelQueuedMove();
    };
  }, []);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (scrollStyleRef.current === 'scrollbar') return;
      if (event.target instanceof Element && event.target.closest('button')) return;
      event.preventDefault();
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      const rect = stage.getBoundingClientRect();
      const remote = frameRef.current;
      const pos = remotePoint(
        event.clientX - rect.left,
        event.clientY - rect.top,
        remote.width,
        remote.height,
        transformRef.current,
        false,
      );
      if (pos && !viewOnlyRef.current) {
        cancelQueuedMove();
        const move = pointerMoveMessage(pos, false);
        if (move) sendPointer([move]);
      }
      const wheel = wheelMessages(
        event.deltaX,
        event.deltaY,
        event.deltaMode,
        wheelAccumRef.current.x,
        wheelAccumRef.current.y,
        reverseRef.current,
        viewOnlyRef.current,
      );
      wheelAccumRef.current = { x: wheel.nextAccumX, y: wheel.nextAccumY };
      if (wheel.messages.length > 0) sendPointer(wheel.messages);
    };
    stage.addEventListener('wheel', onWheel, { passive: false });
    return () => stage.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const publish = (tracked: TrackedKey[]) => {
      trackedKeysRef.current = tracked;
      onArmKeysRef.current(tracked.map((item) => item.release));
    };
    const foreignField = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return false;
      const capture = captureRef.current;
      if (capture && (target === capture || capture.contains(target))) return false;
      return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const isolate = shouldIsolateKeyboardEvent({
        phase: 'live',
        chromeOpen: false,
        insideChromeInput: foreignField(event.target),
      });
      if (!isolate) return;
      if (composingRef.current || isImeEvent(event)) return;
      event.preventDefault();
      event.stopPropagation();
      const next = noteKeyDown(trackedKeysRef.current, event, viewOnlyRef.current);
      publish(next.tracked);
      if (next.messages.length > 0) onKeyboardRef.current(adaptKeyMessages(next.messages, localOsRef.current, classifyRemoteOs(remotePlatformRef.current)));
    };
    const onKeyUp = (event: KeyboardEvent) => {
      const isolate = shouldIsolateKeyboardEvent({
        phase: 'live',
        chromeOpen: false,
        insideChromeInput: foreignField(event.target),
      });
      if (!isolate) return;
      if (composingRef.current || isImeEvent(event) || performance.now() - compositionEndedAtRef.current < 80) return;
      event.preventDefault();
      event.stopPropagation();
      const next = noteKeyUp(trackedKeysRef.current, event, viewOnlyRef.current);
      publish(next.tracked);
      if (next.messages.length > 0) onKeyboardRef.current(adaptKeyMessages(next.messages, localOsRef.current, classifyRemoteOs(remotePlatformRef.current)));
    };
    const onBlur = () => {
      composingRef.current = false;
      const released = releaseTrackedKeys(trackedKeysRef.current);
      publish(released.tracked);
      if (released.messages.length > 0) onKeyboardRef.current(adaptKeyMessages(released.messages, localOsRef.current, classifyRemoteOs(remotePlatformRef.current)));
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      const released = releaseTrackedKeys(trackedKeysRef.current);
      publish(released.tracked);
      if (released.messages.length > 0) onKeyboardRef.current(adaptKeyMessages(released.messages, localOsRef.current, classifyRemoteOs(remotePlatformRef.current)));
    };
  }, []);

  const clearLongPress = () => {
    if (longTimerRef.current !== null) window.clearTimeout(longTimerRef.current);
    longTimerRef.current = null;
  };

  const runTouch = (effects: TouchGestureEffect[]) => {
    const outcome = applyTouchEffects(
      effects,
      touchCursorRef.current,
      (x, y, clamp) => remotePoint(x, y, frameRef.current.width, frameRef.current.height, transformRef.current, clamp),
      viewOnlyRef.current,
      transformRef.current.scale,
      reverseRef.current,
    );
    touchCursorRef.current = outcome.cursor;
    if (outcome.cancelLongPress) clearLongPress();
    if (outcome.armLongPress) {
      clearLongPress();
      const armed = effects.find((effect) => effect.type === 'arm-long-press');
      if (armed && armed.type === 'arm-long-press') {
        const pointerId = armed.pointerId;
        longTimerRef.current = window.setTimeout(() => {
          longTimerRef.current = null;
          const next = gestureLongPressTimeout(gestureRef.current, pointerId);
          gestureRef.current = next.state;
          runTouch(next.effects);
        }, LONG_PRESS_MS);
      }
    }
    if (outcome.messages.length > 0) sendPointer(outcome.messages);
    if (outcome.pan) {
      const panStep = outcome.pan;
      setViewMode((mode) => (mode === 'fit' ? 'custom' : mode));
      setPan((current) => clampPan(
        boxRef.current.width,
        boxRef.current.height,
        frameRef.current.width,
        frameRef.current.height,
        transformRef.current.scale,
        current.panX + panStep.dx,
        current.panY + panStep.dy,
        { allowEdgePan: true, edgePadding: 48, bottomInset: keyboardOpen ? 112 : 0 },
      ));
    }
    if (outcome.pinch) {
      const pinch = outcome.pinch;
      const step = computePinchStep(
        boxRef.current.width,
        boxRef.current.height,
        frameRef.current.width,
        frameRef.current.height,
        transformRef.current,
        pinch.prevMidX,
        pinch.prevMidY,
        pinch.prevDist,
        pinch.nextMidX,
        pinch.nextMidY,
        pinch.nextDist,
        { allowEdgePan: true, edgePadding: 48, bottomInset: keyboardOpen ? 112 : 0 },
      );
      setViewMode(step.viewMode);
      setZoom(step.zoom);
      setPan(step.pan);
    }
  };

  const localPoint = (clientX: number, clientY: number) => {
    const stage = stageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      if (event.target instanceof Element && event.target.closest('button, input, select, label')) return;
      event.preventDefault();
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The pointer can already be gone.
      }
      const local = localPoint(event.clientX, event.clientY);
      if (!local) return;
      const next = gesturePointerDown(gestureRef.current, event.pointerId, local.x, local.y, {
        mode: touchModeRef.current ? 'touch' : 'mouse',
        hand: false,
        now: Date.now(),
        isPrimary: event.isPrimary,
      });
      gestureRef.current = next.state;
      runTouch(next.effects);
      return;
    }
    if (event.target instanceof Element && event.target.closest('button')) return;
    if (viewOnlyRef.current) return;
    const local = localPoint(event.clientX, event.clientY);
    if (!local) return;
    const remote = frameRef.current;
    const pos = remotePoint(local.x, local.y, remote.width, remote.height, transformRef.current, false);
    if (!pos) return;
    anchorRef.current = pos;
    const button = desktopPointerButton(event.button, swapRef.current);
    if (!button) return;
    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // The pointer can already be gone on a synthetic event.
    }
    cancelQueuedMove();
    dragRef.current = { pointerId: event.pointerId, button, point: pos };
    armPointer({ type: 'mouse', action: 'up', button, x: pos.x, y: pos.y });
    sendPointer(pointerDownMessages(button, pos, false));
    captureRef.current?.focus({ preventScroll: true });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      if (!gestureRef.current.pointers.has(event.pointerId)) return;
      const local = localPoint(event.clientX, event.clientY);
      if (!local) return;
      const next = gesturePointerMove(gestureRef.current, event.pointerId, local.x, local.y, {
        mode: touchModeRef.current ? 'touch' : 'mouse',
        now: Date.now(),
      });
      gestureRef.current = next.state;
      runTouch(next.effects);
      return;
    }
    if (viewOnlyRef.current) return;
    const local = localPoint(event.clientX, event.clientY);
    if (!local) return;
    const remote = frameRef.current;
    const drag = dragRef.current;
    const dragging = Boolean(drag && drag.pointerId === event.pointerId);
    const pos = remotePoint(local.x, local.y, remote.width, remote.height, transformRef.current, dragging);
    if (!pos) return;
    if (dragging && drag) {
      drag.point = pos;
      cancelQueuedMove();
      armPointer({ type: 'mouse', action: 'up', button: drag.button, x: pos.x, y: pos.y });
      const move = pointerMoveMessage(pos, false);
      if (move) sendPointer([move]);
      return;
    }
    queueMove(pos);
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      if (!gestureRef.current.pointers.has(event.pointerId)) return;
      const local = localPoint(event.clientX, event.clientY);
      if (!local) return;
      const next = gesturePointerUpOrCancel(
        gestureRef.current,
        event.pointerId,
        local.x,
        local.y,
        event.type === 'pointercancel' || event.type === 'lostpointercapture' ? 'cancel' : 'up',
        { now: Date.now() },
      );
      gestureRef.current = next.state;
      runTouch(next.effects);
      return;
    }
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const local = localPoint(event.clientX, event.clientY);
    const remote = frameRef.current;
    const pos = local
      ? remotePoint(local.x, local.y, remote.width, remote.height, transformRef.current, true)
      : drag.point;
    dragRef.current = null;
    armPointer(null);
    if (viewOnlyRef.current || !pos) return;
    cancelQueuedMove();
    sendPointer(pointerUpMessages(drag.button, pos, false));
  };

  const cursorScreen = showCursor && cursor ? mapFromRemote(cursor.x, cursor.y, transform) : null;
  useEffect(() => {
    if (!followRemoteCursor || !cursorScreen || viewMode === 'fit' || viewMode === 'stretch') return;
    setPan((current) => {
      const next = panToKeepVisible(box.width, box.height, cursorScreen.x, cursorScreen.y, current.panX, current.panY);
      if (next.panX === current.panX && next.panY === current.panY) return current;
      return next;
    });
  }, [followRemoteCursor, cursorScreen, viewMode, box.width, box.height]);
  const chrome = sessionChromeMode({
    width: box.width,
    coarsePointer,
    keyboardOpen,
    viewportNarrow,
  });
  useEffect(() => {
    const sync = () => {
      const action = keyboardLockAction(classifyBrowser(navigator.userAgent), window.isSecureContext, document.fullscreenElement === stageRef.current);
      const keyboard = readKeyboardLock(navigator);
      if (!keyboard) return;
      if (action === 'lock') void keyboard.lock().catch(() => undefined);
      else if (action === 'unlock') keyboard.unlock();
    };
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      readKeyboardLock(navigator)?.unlock();
    };
  }, []);
  const autoKeyboardArmed = useRef(false);
  useEffect(() => {
    if (!autoKeyboard || chrome !== 'dock' || autoKeyboardArmed.current) return;
    autoKeyboardArmed.current = true;
    setKeyboardOpen(true);
    keyboardLayout.begin();
  }, [autoKeyboard, chrome, keyboardLayout]);

  return (
    <div
      ref={stageRef}
      className="stage"
      data-testid="stage"
      data-keyboard-avoiding={keyboardLayout.viewport ? 'true' : undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onLostPointerCapture={onPointerUp}
      onContextMenu={(event) => event.preventDefault()}
      style={{
        position: 'fixed',
        inset: keyboardLayout.viewport ? 'auto' : 0,
        left: keyboardLayout.viewport?.left,
        top: keyboardLayout.viewport?.top,
        width: keyboardLayout.viewport?.width,
        height: keyboardLayout.viewport?.height,
        background: '#101418',
        touchAction: scrollStyle === 'scrollbar' ? 'pan-x pan-y' : 'none',
        overflow: scrollStyle === 'scrollbar' ? 'auto' : 'hidden',
        cursor: showCursor ? 'none' : 'default',
      }}
    >
      <canvas
        ref={canvasRef}
        data-testid="canvas"
        style={{
          position: 'absolute',
          left: transform.panX,
          top: transform.panY,
          width: frameWidth > 0 ? frameWidth * (transform.scaleX ?? transform.scale) : undefined,
          height: frameHeight > 0 ? frameHeight * (transform.scaleY ?? transform.scale) : undefined,
          background: '#101418',
        }}
      />
      {showCursor && cursorScreen ? (
        <div
          data-testid="remote-cursor"
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: cursorScreen.x,
            top: cursorScreen.y,
            pointerEvents: 'none',
            zIndex: 2,
            transform: enlargeCursor ? 'scale(2)' : undefined,
            transformOrigin: '0 0',
          }}
        >
          {cursorShape ? (
            <canvas
              ref={cursorCanvasRef}
              width={cursorShape.width}
              height={cursorShape.height}
              style={{ position: 'absolute', left: -cursorShape.hotX, top: -cursorShape.hotY }}
            />
          ) : (
            <MousePointer2 size={18} fill="#fff" stroke="#171717" />
          )}
        </div>
      ) : null}
      <input
        ref={captureRef}
        type="text"
        data-testid="capture"
        aria-hidden="true"
        tabIndex={-1}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          compositionEndedAtRef.current = performance.now();
          const committed = event.data || event.currentTarget.value;
          event.currentTarget.value = '';
          const messages = textMessages(committed, viewOnlyRef.current);
          if (messages.length > 0) onKeyboardRef.current(messages);
        }}
        onInput={(event) => {
          if (composingRef.current) return;
          const value = event.currentTarget.value;
          if (!value) return;
          event.currentTarget.value = '';
          const messages = textMessages(value, viewOnlyRef.current);
          if (messages.length > 0) onKeyboardRef.current(messages);
        }}
        style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 1, height: 1 }}
      />
      {chrome !== 'keyboard' ? (
        <DiagnosticsPanel
          locale={locale}
          open={diagnosticsOpen}
          snapshot={{ ...stats, now: 0, decodeError }}
          linkQuality={linkQuality}
          onCopy={onCopyDiagnostics}
        />
      ) : null}
      {chrome === 'dock' ? (
        <MobileSessionDock
          locale={locale}
          touchMode={touchMode}
          displays={displays}
          currentDisplay={currentDisplay}
          quality={quality}
          audioEnabled={audioEnabled}
          audioIssue={audioIssue}
          volume={volume}
          viewOnly={viewOnly}
          privacyAllowed={privacyAllowed}
          diagnosticsOpen={diagnosticsOpen}
          onToggleKeyboard={() => {
            setKeyboardOpen(true);
            keyboardLayout.begin();
          }}
          onToggleTouchMode={() => setTouchMode((current) => !current)}
          onSwitchDisplay={onSwitchDisplay}
          onQuality={onQuality}
          onToggleAudio={onToggleAudio}
          onVolume={onVolume}
          onToggleViewOnly={onToggleViewOnly}
          onFullscreen={() => toggleFullscreen(stageRef.current)}
          onDisconnect={onDisconnect}
          onToggleDiagnostics={onToggleDiagnostics}
          remotePlatform={remotePlatform}
          onQuickKey={sendQuickKey}
          onOpenClipboard={() => setClipboardOpen(true)}
          privacyEnabled={privacyEnabled}
          privacyPending={privacyPending}
          privacyFailed={privacyFailed}
          onTogglePrivacy={onTogglePrivacy}
          resolutions={resolutions}
          frameWidth={frameWidth}
          frameHeight={frameHeight}
          onResolution={onResolution}
          restartAllowed={restartAllowed}
          restartNotice={restartNotice}
          onRestart={onRestart}
        />
      ) : null}
      {chrome === 'keyboard' ? (
        <SoftKeyboardBar
          locale={locale}
          viewOnly={viewOnly}
          onSend={sendKeys}
          onHide={() => setKeyboardOpen(false)}
        />
      ) : null}
      {chrome === 'desktop' ? (
        <SessionToolbar
          locale={locale}
          displays={displays}
          currentDisplay={currentDisplay}
          quality={quality}
          viewOnly={viewOnly}
          privacyAllowed={privacyAllowed}
          onSwitchDisplay={onSwitchDisplay}
          onQuality={onQuality}
          onToggleViewOnly={onToggleViewOnly}
          audioEnabled={audioEnabled}
          audioIssue={audioIssue}
          volume={volume}
          onToggleAudio={onToggleAudio}
          onVolume={onVolume}
          onFullscreen={() => toggleFullscreen(stageRef.current)}
          onDisconnect={onDisconnect}
          remotePlatform={remotePlatform}
          onQuickKey={sendQuickKey}
          onOpenClipboard={() => setClipboardOpen(true)}
          privacyEnabled={privacyEnabled}
          privacyPending={privacyPending}
          privacyFailed={privacyFailed}
          onTogglePrivacy={onTogglePrivacy}
          resolutions={resolutions}
          frameWidth={frameWidth}
          frameHeight={frameHeight}
          onResolution={onResolution}
          restartAllowed={restartAllowed}
          restartNotice={restartNotice}
          onRestart={onRestart}
        />
      ) : null}
      <ClipboardPanel
        locale={locale}
        open={clipboardOpen}
        incoming={clipboardFallback}
        permitted={clipboardPermitted}
        disabled={clipboardDisabled}
        onSend={onSendClipboard}
        onClose={() => {
          setClipboardOpen(false);
          onDismissClipboard();
        }}
      />
    </div>
  );
}

function toggleFullscreen(stage: HTMLElement | null) {
  if (!stage) return;
  if (document.fullscreenElement) {
    void document.exitFullscreen();
  } else {
    void stage.requestFullscreen();
  }
}
