import { useCallback, useEffect, useRef, useState, type Dispatch, type PointerEvent, type RefObject, type SetStateAction } from 'react';
import { applyMouseButtonSwap, applyWheelDirection, type DisplayPrefs } from '../lib/displayPrefs';
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
} from '../lib/gestures';
import { isBrowserNavOrAuxButton, shouldPreventStageTouch, shouldPreventWindowWheel } from '../lib/inputIsolation';
import { mapFromRemote, mapToRemote, mapToRemoteClamped, type Point, type ViewTransform } from '../lib/mapping';
import type { ClientMessage } from '../lib/protocol';

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
