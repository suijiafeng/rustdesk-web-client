import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { SOFT_KEYBOARD_BAR_HEIGHT, keyboardSpaceToReserve, keyboardView, virtualKeyboardHeight } from '../lib/keyboardViewport';
import { fitScale, type Point, type ViewMode, type ViewTransform } from '../lib/mapping';

interface ViewState {
  mode: ViewMode;
  zoom: number;
  view: ViewTransform;
}
export type SoftKeyboardMode = 'system' | 'virtual';

const NATIVE_KEYBOARD_VISIBLE_PX = 80;
const NATIVE_KEYBOARD_HIDDEN_PX = 24;
const VIEWPORT_SETTLE_MS = 160;
const SYSTEM_SWITCH_TIMEOUT_MS = 900;

interface SystemTransition {
  startedAt: number;
  changedAt: number;
  inset: number;
}

interface Options {
  enabled: boolean;
  softKeys: boolean;
  mode: SoftKeyboardMode;
  stage: RefObject<HTMLElement | null>;
  read: () => ViewState & { remoteW: number; remoteH: number; anchor: Point };
  onSystemDismiss: () => void;
  apply: (box: { w: number; h: number }, state: ViewState) => void;
}
interface KeyboardSession {
  before: ReturnType<Options['read']>;
  height: number;
  width: number;
  origin: Point;
  offset: Point;
  shown: boolean;
  systemHeight?: number;
  nativeShown: boolean;
  systemTransition?: SystemTransition;
  dismissSince?: number;
  manual: ViewState | null;
}
interface ViewportRect { left: number; top: number; width: number; height: number }

export function useKeyboardViewport(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const session = useRef<KeyboardSession | null>(null);
  const [viewport, setViewport] = useState<ViewportRect | null>(null);
  const active = useRef(false);
  const [reservedSpace, setReservedSpace] = useState(0);

  const begin = useCallback(() => {
    if (session.current || !latest.current.enabled) return;
    const vv = window.visualViewport;
    const rect = latest.current.stage.current?.getBoundingClientRect();
    if (!vv || !rect || vv.scale > 1.02) return;
    session.current = {
      before: latest.current.read(), height: vv.height, width: vv.width,
      origin: { x: rect.left, y: rect.top }, offset: { x: vv.offsetLeft, y: vv.offsetTop }, shown: false, nativeShown: false, manual: null,
    };
  }, []);

  const switchMode = useCallback((mode: SoftKeyboardMode) => {
    const current = session.current;
    if (!current) return;
    const vv = window.visualViewport;
    if (mode === 'virtual' && vv && Math.abs(vv.width - current.width) < 80) {
      const inset = current.height - vv.height;
      if (inset > NATIVE_KEYBOARD_VISIBLE_PX) current.systemHeight = inset;
    }
    const now = performance.now();
    current.nativeShown = false;
    current.dismissSince = undefined;
    current.systemTransition = mode === 'system' ? {
      startedAt: now, changedAt: now, inset: vv ? Math.max(0, current.height - vv.height) : 0,
    } : undefined;
  }, []);

  const markManual = useCallback((view: ViewTransform, mode: ViewMode, zoom: number) => {
    if (session.current && active.current) session.current.manual = { view, mode, zoom };
  }, []);

  useLayoutEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;
    let transitionTimer: ReturnType<typeof setTimeout> | undefined;
    const sync = () => {
      frame = 0;
      clearTimeout(transitionTimer);
      const current = session.current;
      if (!current) return;
      const { enabled, softKeys, mode: keyboardMode, read, apply, stage, onSystemDismiss } = latest.current;
      if (!enabled || vv.scale > 1.02) {
        active.current = false;
        session.current = null;
        setViewport(null);
        setReservedSpace(0);
        return;
      }
      let rotated = Math.abs(vv.width - current.width) > 80;
      const switchingToSystem = softKeys && keyboardMode === 'system' ? current.systemTransition : undefined;
      if (rotated && softKeys && (keyboardMode === 'virtual' || switchingToSystem)) {
        current.width = vv.width;
        current.height = Math.max(vv.height, window.innerHeight);
        current.systemHeight = undefined;
        current.nativeShown = false;
        current.dismissSince = undefined;
        const now = read();
        current.before = {
          ...now, mode: 'fit', zoom: 1,
          view: keyboardView(vv.width, vv.height, now.remoteW, now.remoteH, 'fit', now.view, now.anchor),
        };
        current.manual = null;
        rotated = false;
      }
      const nowMs = performance.now();
      const nativeInset = Math.max(0, current.height - vv.height);
      const obscured = nativeInset > (current.shown ? NATIVE_KEYBOARD_HIDDEN_PX : NATIVE_KEYBOARD_VISIBLE_PX);
      let settling = false;
      if (switchingToSystem) {
        if (Math.abs(nativeInset - switchingToSystem.inset) >= 1) {
          switchingToSystem.inset = nativeInset;
          switchingToSystem.changedAt = nowMs;
        }
        const remaining = switchingToSystem.startedAt + SYSTEM_SWITCH_TIMEOUT_MS - nowMs;
        const quiet = switchingToSystem.changedAt + VIEWPORT_SETTLE_MS - nowMs;
        if (remaining > 0 && (nativeInset <= NATIVE_KEYBOARD_VISIBLE_PX || quiet > 0)) {
          settling = true;
          transitionTimer = setTimeout(schedule, nativeInset <= NATIVE_KEYBOARD_VISIBLE_PX ? remaining : Math.min(remaining, quiet));
        } else {
          current.systemTransition = undefined;
        }
      }

      let dismissing = false;
      if (softKeys && keyboardMode === 'system' && !settling && !rotated) {
        if (nativeInset > NATIVE_KEYBOARD_VISIBLE_PX) {
          current.nativeShown = true;
          current.systemHeight = nativeInset;
        }
        if (nativeInset >= NATIVE_KEYBOARD_HIDDEN_PX) {
          current.dismissSince = undefined;
        } else if (current.nativeShown) {
          current.dismissSince ??= nowMs;
          const remaining = current.dismissSince + VIEWPORT_SETTLE_MS - nowMs;
          if (remaining <= 0) {
            current.nativeShown = false;
            current.dismissSince = undefined;
            onSystemDismiss();
            return;
          }
          dismissing = true;
          transitionTimer = setTimeout(schedule, remaining);
        }
      }

      const preferredHeight = virtualKeyboardHeight(current.height, current.width > current.height, current.systemHeight);
      const holdSpace = softKeys && (keyboardMode === 'virtual' || settling || dismissing);
      // Ignore intermediate viewport heights while changing keyboards. The
      // browser can briefly report a fullscreen or undersized visual viewport.
      const visibleHeight = holdSpace ? Math.max(vv.height, current.height - preferredHeight) : vv.height;
      const reserve = holdSpace ? keyboardSpaceToReserve(current.height, visibleHeight, preferredHeight) : 0;
      setReservedSpace(reserve);
      // On rotation the old height is no longer a keyboard baseline. Keep using the
      // visible area while the keyboard is open, but do not restore a portrait snapshot.
      if ((!softKeys && (rotated || !current.shown || !obscured)) ||
          (!holdSpace && !rotated && current.shown && !obscured)) {
        const size = { w: vv.width, h: vv.height };
        const now = read();
        let state: ViewState = current.before;
        if (rotated) {
          state = { mode: 'fit', zoom: 1, view: keyboardView(size.w, size.h, now.remoteW, now.remoteH, 'fit', now.view, now.anchor) };
        } else if (current.manual) {
          const view = { ...current.manual.view, panX: current.manual.view.panX + current.offset.x - current.origin.x,
            panY: current.manual.view.panY + current.offset.y - current.origin.y };
          state = { mode: 'custom', zoom: view.scale / fitScale(size.w, size.h, now.remoteW, now.remoteH), view };
        }
        active.current = false;
        session.current = softKeys ? {
          ...current, before: { ...read(), ...state }, height: vv.height, width: vv.width,
          origin: { x: vv.offsetLeft, y: vv.offsetTop }, offset: { x: vv.offsetLeft, y: vv.offsetTop },
          shown: false, nativeShown: false, manual: null,
        } : null;
        setViewport(null);
        apply(size, state);
        return;
      }
      if (!holdSpace && !obscured && !current.shown) return;
      current.shown = true;
      active.current = true;
      const rect = { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: visibleHeight };
      current.offset = { x: rect.left, y: rect.top };
      const barHeight = softKeys ? stage.current?.querySelector('[data-testid="softbar"]')?.getBoundingClientRect().height ?? SOFT_KEYBOARD_BAR_HEIGHT : 0;
      const size = { w: rect.width, h: Math.max(1, rect.height - barHeight - reserve) };
      const now = read();
      let view: ViewTransform;
      let mode: ViewMode;
      if (current.manual) {
        mode = current.manual.mode === 'fit' ? 'custom' : current.manual.mode;
        view = current.manual.view;
      } else {
        mode = rotated ? 'fit' : current.before.mode;
        const previous = { ...current.before.view,
          panX: current.before.view.panX + current.origin.x - rect.left,
          panY: current.before.view.panY + current.origin.y - rect.top };
        view = keyboardView(size.w, size.h, now.remoteW, now.remoteH, mode, previous, current.before.anchor);
      }
      setViewport(previous => previous && previous.left === rect.left && previous.top === rect.top && previous.width === rect.width && previous.height === rect.height ? previous : rect);
      apply(size, { mode, zoom: view.scale / fitScale(size.w, size.h, now.remoteW, now.remoteH), view });
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(sync);
    };
    sync();
    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    window.addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(transitionTimer);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [options.enabled, options.softKeys, options.mode]);

  return { viewport, reservedSpace, active, pending: session, begin, switchMode, markManual };
}
