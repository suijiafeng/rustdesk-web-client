import { useEffect, useRef } from 'react';
import type { RefObject, MutableRefObject } from 'react';
import type { DisplayPrefs } from '../lib/displayPrefs';
import {
  accumulateWheelTicks,
  consumeThreeFingerScroll,
  type TouchGestureEffect,
  type TouchGestureState,
} from '../lib/gestures';
import {
  isBrowserNavOrAuxButton,
  shouldPreventStageTouch,
  shouldPreventWindowWheel,
} from '../lib/inputIsolation';
import type { ClientMessage } from '../lib/protocol';

interface UseStageNativeEventsOptions {
  stageRef: RefObject<HTMLElement | null>;
  canvasRef: RefObject<HTMLCanvasElement | null>;
  remoteInput: boolean;
  remoteInputRef: MutableRefObject<boolean>;
  touchModeRef: MutableRefObject<boolean>;
  displayPrefsRef: RefObject<DisplayPrefs>;
  viewRef: RefObject<{ scale: number }>;
  touchGestureRef: MutableRefObject<TouchGestureState>;
  nativeScrollRef: MutableRefObject<{ y: number; remainder: number; count: number; x: number; anchorY: number } | null>;
  touchFallbackPinchRef: MutableRefObject<{ midX: number; midY: number; dist: number } | null>;
  nativeTouchInfoRef: MutableRefObject<{ count: number; updatedAt: number }>;
  zeroTouchTimerRef: MutableRefObject<number | null>;
  wheelAccumRef: MutableRefObject<{ x: number; y: number }>;
  applyPinchStepRef: MutableRefObject<(pMidX: number, pMidY: number, pDist: number, cMidX: number, cMidY: number, cDist: number) => void>;
  resetAllGesturesRef: MutableRefObject<() => void>;
  runTouchEffectsRef: MutableRefObject<(effects: TouchGestureEffect[]) => void>;
  stageLocalPoint: (clientX: number, clientY: number) => { x: number; y: number };
  remoteFromLocal: (localX: number, localY: number) => { x: number; y: number } | null;
  remoteFromLocalClamped: (localX: number, localY: number) => { x: number; y: number } | null;
  cursorPoint: () => { x: number; y: number };
  cancelQueuedMove: () => void;
  setScaleAround: (nextScale: number, anchorX: number, anchorY: number) => void;
  send: (msg: ClientMessage) => void;
}

/**
 * Registers non-passive stage wheel, iOS gesture, native multi-touch fallback,
 * and window-level input isolation listeners for the remote desktop stage.
 */
export function useStageNativeEvents({
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
}: UseStageNativeEventsOptions): void {
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
      if (!Array.from(e.changedTouches).some((touch) => isStageSurface(touch.target))) return;
      const touches = Array.from(e.touches).filter((touch) => isStageSurface(touch.target));
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
      if (!Array.from(e.changedTouches).some((touch) => isStageSurface(touch.target))) return;
      const touches = Array.from(e.touches).filter((touch) => isStageSurface(touch.target));
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
      if (!Array.from(e.changedTouches).some((touch) => isStageSurface(touch.target))) return;
      const touches = Array.from(e.touches).filter((touch) => isStageSurface(touch.target));
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
}
