import { useCallback, useEffect, useRef, useState, type Dispatch, type PointerEvent, type RefObject, type SetStateAction } from 'react';
import { applyMouseButtonSwap, applyWheelDirection, type DisplayPrefs } from '../lib/displayPrefs';
import {
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
} from '../lib/gestures';
import { mapFromRemote, mapToRemote, mapToRemoteClamped, type Point, type ViewTransform } from '../lib/mapping';
import type { ClientMessage } from '../lib/protocol';
import { useStageNativeEvents } from './useStageNativeEvents';

interface Options {
  isCoarseDevice: boolean;
  touchMode: boolean;
  setTouchMode: Dispatch<SetStateAction<boolean>>;
  isMobileViewport: boolean;
  isTouchLayout: boolean;
  remoteInput: boolean;
  send: (message: ClientMessage) => void;
  displayPrefsRef: RefObject<DisplayPrefs>;
  stageRef: RefObject<HTMLElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  cursorElRef: RefObject<HTMLDivElement | null>;
  cursorCanvasRef: RefObject<HTMLCanvasElement | null>;
  cursorShape: { pixels: ImageData; hotX: number; hotY: number } | null;
  sizeRef: RefObject<{ width: number; height: number }>;
  cursorRef: RefObject<Point>;
  lastInputPointRef: RefObject<Point | null>;
  followCursorRef: RefObject<(x: number, y: number) => void>;
  viewRef: RefObject<ViewTransform>;
  view: ViewTransform;
  remoteW: number;
  remoteH: number;
  panBy: (dx: number, dy: number, manual?: boolean) => void;
  setScaleAround: (nextScale: number, anchorX: number, anchorY: number) => void;
  applyPinchStepRef: RefObject<(
    prevMidX: number, prevMidY: number, prevDist: number,
    nextMidX: number, nextMidY: number, nextDist: number,
  ) => void>;
  openSoftKeyboard: () => void;
  softKeys: boolean;
  textCursor: boolean;
  chromeRef: RefObject<{ menu: boolean; dialog: boolean }>;
  closeChrome: () => void;
  focusDesktopCapture: () => void;
  toolbarExpanded: boolean;
  toolbarPinned: boolean;
  setToolbarExpanded: Dispatch<SetStateAction<boolean>>;
}

export function useRemotePointer({
  isCoarseDevice,
  touchMode,
  setTouchMode,
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
}: Options) {
  const [virtualCursorVisible, setVirtualCursorVisible] = useState(false);

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

  const remoteInputRef = useRef(remoteInput);
  remoteInputRef.current = remoteInput;

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
      el.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0)`;
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
    el.style.transform = `translate3d(${screen.x}px, ${screen.y}px, 0)`;
  }, [view.scale, view.panX, view.panY, virtualCursorVisible]);

  useEffect(() => {
    if (cursorShape) {
      cursorCanvasRef.current?.getContext('2d')?.putImageData(cursorShape.pixels, 0, 0);
    }
  }, [cursorShape]);

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
  const handlePointerDown = (e: PointerEvent<HTMLElement>) => {
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

  const handlePointerMove = (e: PointerEvent<HTMLElement>) => {
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

  const handlePointerUpOrCancel = (e: PointerEvent<HTMLElement>) => {
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

  const handleLostPointerCapture = (e: PointerEvent<HTMLElement>) => {
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

  useStageNativeEvents({
    stageRef,
    canvasRef,
    remoteInput,
    remoteInputRef,
    touchModeRef,
    displayPrefsRef,
    viewRef,
    touchGestureRef,
    nativeScrollRef,
    touchFallbackPinchRef,
    nativeTouchInfoRef,
    zeroTouchTimerRef,
    wheelAccumRef,
    applyPinchStepRef,
    resetAllGesturesRef,
    runTouchEffectsRef,
    stageLocalPoint,
    remoteFromLocal,
    remoteFromLocalClamped,
    cursorPoint,
    cancelQueuedMove,
    setScaleAround,
    send,
  });

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

  return {
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
  };
}
