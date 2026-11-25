import { useCallback, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { keyboardView } from '../lib/keyboardViewport';
import { fitScale, type Point, type ViewMode, type ViewTransform } from '../lib/mapping';

interface ViewState {
  mode: ViewMode;
  zoom: number;
  view: ViewTransform;
}
interface Options {
  enabled: boolean;
  softKeys: boolean;
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
  manual: ViewState | null;
}
interface ViewportRect { left: number; top: number; width: number; height: number }

export function useKeyboardViewport(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const session = useRef<KeyboardSession | null>(null);
  const [viewport, setViewport] = useState<ViewportRect | null>(null);
  const active = useRef(false);

  const begin = useCallback(() => {
    if (session.current || !latest.current.enabled) return;
    const vv = window.visualViewport;
    const rect = latest.current.stage.current?.getBoundingClientRect();
    if (!vv || !rect || vv.scale > 1.02) return;
    session.current = {
      before: latest.current.read(), height: vv.height, width: vv.width,
      origin: { x: rect.left, y: rect.top }, offset: { x: vv.offsetLeft, y: vv.offsetTop }, shown: false, manual: null,
    };
  }, []);

  const markManual = useCallback((view: ViewTransform, mode: ViewMode, zoom: number) => {
    if (session.current && active.current) session.current.manual = { view, mode, zoom };
  }, []);

  useLayoutEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let frame = 0;
    const sync = () => {
      frame = 0;
      const current = session.current;
      if (!current) return;
      const { enabled, softKeys, read, apply, stage } = latest.current;
      if (!enabled || vv.scale > 1.02) {
        active.current = false;
        session.current = null;
        setViewport(null);
        return;
      }
      const rotated = Math.abs(vv.width - current.width) > 80;
      const obscured = current.height - vv.height > (current.shown ? 24 : 80);
      // On rotation the old height is no longer a keyboard baseline. Keep using the
      // visible area while the keyboard is open, but do not restore a portrait snapshot.
      if (!softKeys && (rotated || !current.shown || !obscured) || !rotated && current.shown && !obscured) {
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
        session.current = null;
        setViewport(null);
        apply(size, state);
        return;
      }
      if (!obscured && !current.shown) return;
      current.shown = true;
      active.current = true;
      const rect = { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height };
      current.offset = { x: rect.left, y: rect.top };
      const barHeight = softKeys ? stage.current?.querySelector('[data-testid="softbar"]')?.getBoundingClientRect().height ?? 46 : 0;
      const size = { w: rect.width, h: Math.max(1, rect.height - barHeight) };
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
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
    };
  }, [options.enabled, options.softKeys]);

  return { viewport, active, pending: session, begin, markManual };
}
