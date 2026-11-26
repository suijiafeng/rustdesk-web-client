import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { SOFT_KEYBOARD_BAR_HEIGHT, keyboardSpaceToReserve, keyboardView, virtualKeyboardHeight } from '../lib/keyboardViewport';
import { fitScale, type Point, type ViewMode, type ViewTransform } from '../lib/mapping';

interface ViewState {
  mode: ViewMode;
  zoom: number;
  view: ViewTransform;
}
export type SoftKeyboardMode = 'system' | 'virtual';

interface Options {
  enabled: boolean;
  softKeys: boolean;
  mode: SoftKeyboardMode;
  stage: RefObject<HTMLElement | null>;
  read: () => ViewState & { remoteW: number; remoteH: number; anchor: Point };
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
  systemSwitchUntil: number;
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
      origin: { x: rect.left, y: rect.top }, offset: { x: vv.offsetLeft, y: vv.offsetTop }, shown: false, manual: null, systemSwitchUntil: 0,
    };
  }, []);

  const switchMode = useCallback((mode: SoftKeyboardMode) => {
    const current = session.current;
    if (!current) return;
    const vv = window.visualViewport;
    if (mode === 'virtual' && vv && Math.abs(vv.width - current.width) < 80) {
      const inset = current.height - vv.height;
      if (inset > 80) current.systemHeight = inset;
    }
    current.systemSwitchUntil = mode === 'system' ? performance.now() + 500 : 0;
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
      const { enabled, softKeys, mode: keyboardMode, read, apply, stage } = latest.current;
      if (!enabled || vv.scale > 1.02) {
        active.current = false;
        session.current = null;
        setViewport(null);
        setReservedSpace(0);
        return;
      }
      let rotated = Math.abs(vv.width - current.width) > 80;
      const switchingToSystem = softKeys && keyboardMode === 'system' && performance.now() < current.systemSwitchUntil;
      if (rotated && softKeys && (keyboardMode === 'virtual' || switchingToSystem)) {
        current.width = vv.width;
        current.height = Math.max(vv.height, window.innerHeight);
        current.systemHeight = undefined;
        const now = read();
        current.before = {
          ...now, mode: 'fit', zoom: 1,
          view: keyboardView(vv.width, vv.height, now.remoteW, now.remoteH, 'fit', now.view, now.anchor),
        };
        current.manual = null;
        rotated = false;
      }
      const nativeInset = Math.max(0, current.height - vv.height);
      const obscured = nativeInset > (current.shown ? 24 : 80);
      const preferredHeight = virtualKeyboardHeight(current.height, current.width > current.height, current.systemHeight);
      const canWaitForSystem = switchingToSystem && nativeInset < preferredHeight - 8;
      if (canWaitForSystem) {
        transitionTimer = setTimeout(sync, Math.max(1, current.systemSwitchUntil - performance.now()));
      } else if (keyboardMode === 'system') {
        current.systemSwitchUntil = 0;
        if (nativeInset > 80 && !rotated) current.systemHeight = nativeInset;
      }
      const holdSpace = softKeys && (keyboardMode === 'virtual' || canWaitForSystem);
      const reserve = holdSpace ? keyboardSpaceToReserve(current.height, vv.height, preferredHeight) : 0;
      setReservedSpace(reserve);
      // On rotation the old height is no longer a keyboard baseline. Keep using the
      // visible area while the keyboard is open, but do not restore a portrait snapshot.
      if ((!softKeys && (rotated || !current.shown || !obscured)) ||
          (!holdSpace && !rotated && current.shown && !obscured && !canWaitForSystem)) {
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
          shown: false, manual: null,
        } : null;
        setViewport(null);
        apply(size, state);
        return;
      }
      if (!holdSpace && !obscured && !current.shown) return;
      current.shown = true;
      active.current = true;
      const rect = { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height };
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
