// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import {
  EMPTY_HEIGHT_BASELINE,
  KEYBOARD_PENDING_MS,
  ROTATE_WIDTH_PX,
  keyboardIsOpen,
  keyboardOcclusion,
  keyboardView,
  noteViewportHeight,
  pendingKeyboardExpired,
  type HeightBaseline,
} from '../lib/keyboardViewport.ts';
import { fitScale, type Point, type ViewMode, type ViewTransform } from '../lib/mapping.ts';

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

interface ViewportRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function useKeyboardViewport(options: Options) {
  const latest = useRef(options);
  latest.current = options;
  const baseline = useRef<HeightBaseline>({ ...EMPTY_HEIGHT_BASELINE });
  const startedAt = useRef(0);
  const shown = useRef(false);
  const widthAtBegin = useRef(0);
  const manual = useRef<ViewState | null>(null);
  const before = useRef<ReturnType<Options['read']> | null>(null);
  const pending = useRef(false);
  const active = useRef(false);
  const frame = useRef(0);
  const timeoutId = useRef(0);
  const [viewport, setViewport] = useState<ViewportRect | null>(null);

  const clearPending = useCallback(() => {
    pending.current = false;
    shown.current = false;
    active.current = false;
    before.current = null;
    manual.current = null;
    window.clearTimeout(timeoutId.current);
    timeoutId.current = 0;
    setViewport(null);
  }, []);

  const sample = useCallback(() => {
    const vv = window.visualViewport;
    if (!vv) return null;
    return { width: vv.width, height: vv.height, left: vv.offsetLeft, top: vv.offsetTop, scale: vv.scale };
  }, []);

  const sync = useCallback(() => {
    frame.current = 0;
    const vv = sample();
    const current = latest.current;
    if (!vv || !current.enabled || vv.scale > 1.02) {
      clearPending();
      return;
    }
    baseline.current = noteViewportHeight(baseline.current, vv.width, vv.height);
    const occlusion = keyboardOcclusion(baseline.current, vv.width, vv.height);
    const visible = keyboardIsOpen(occlusion, shown.current);
    const rotated = widthAtBegin.current > 0 && Math.abs(vv.width - widthAtBegin.current) > ROTATE_WIDTH_PX;
    if (pending.current && pendingKeyboardExpired(startedAt.current, Date.now(), visible)) {
      clearPending();
      return;
    }
    if (!pending.current && !shown.current) return;
    if (rotated && !visible) {
      clearPending();
      return;
    }
    if (!visible) return;
    shown.current = true;
    pending.current = false;
    active.current = true;
    window.clearTimeout(timeoutId.current);
    timeoutId.current = 0;
    const rect = { left: vv.left, top: vv.top, width: vv.width, height: vv.height };
    const barHeight = current.softKeys
      ? current.stage.current?.querySelector('[data-testid="softbar"]')?.getBoundingClientRect().height ?? 46
      : 0;
    const size = { w: rect.width, h: Math.max(1, rect.height - barHeight) };
    const now = current.read();
    const snapshot = before.current ?? now;
    const mode: ViewMode = manual.current
      ? manual.current.mode === 'fit' ? 'custom' : manual.current.mode
      : snapshot.mode;
    const previous = manual.current?.view ?? snapshot.view;
    const view = keyboardView(size.w, size.h, now.remoteW, now.remoteH, mode, previous, snapshot.anchor);
    setViewport((previousRect) => (
      previousRect
      && previousRect.left === rect.left
      && previousRect.top === rect.top
      && previousRect.width === rect.width
      && previousRect.height === rect.height
        ? previousRect
        : rect
    ));
    current.apply(size, {
      mode,
      zoom: view.scale / fitScale(size.w, size.h, now.remoteW, now.remoteH),
      view,
    });
  }, [clearPending, sample]);

  const schedule = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(sync);
  }, [sync]);

  const begin = useCallback(() => {
    if (!latest.current.enabled || pending.current || shown.current) return;
    const vv = sample();
    if (!vv || vv.scale > 1.02) return;
    baseline.current = noteViewportHeight(baseline.current, vv.width, vv.height);
    before.current = latest.current.read();
    widthAtBegin.current = vv.width;
    startedAt.current = Date.now();
    pending.current = true;
    shown.current = false;
    manual.current = null;
    window.clearTimeout(timeoutId.current);
    timeoutId.current = window.setTimeout(() => {
      if (pending.current && !shown.current) clearPending();
    }, KEYBOARD_PENDING_MS);
    schedule();
  }, [clearPending, sample, schedule]);

  const markManual = useCallback((view: ViewTransform, mode: ViewMode, zoom: number) => {
    if (active.current) manual.current = { view, mode, zoom };
  }, []);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onChange = () => schedule();
    vv.addEventListener('resize', onChange);
    vv.addEventListener('scroll', onChange);
    window.addEventListener('resize', onChange);
    return () => {
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
      window.clearTimeout(timeoutId.current);
      timeoutId.current = 0;
      vv.removeEventListener('resize', onChange);
      vv.removeEventListener('scroll', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, [schedule]);

  return { viewport, active, pending, begin, markManual };
}
