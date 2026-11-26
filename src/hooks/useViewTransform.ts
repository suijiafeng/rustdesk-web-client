import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { ConnectionPhase } from '../components/RustDeskShell';
import { isPageZoomed, keyboardInset } from '../lib/gestures';
import { SOFT_KEYBOARD_BAR_HEIGHT } from '../lib/keyboardViewport';
import {
  DEFAULT_EDGE_PADDING,
  clampPan,
  computeNextScaleState,
  computePinchStep,
  computeViewTransform,
  fitScale,
  mapFromRemote,
  type Point,
  type ViewMode,
  type ViewTransform,
} from '../lib/mapping';
import { useKeyboardViewport, type SoftKeyboardMode } from './useKeyboardViewport';

interface Options {
  initialViewStyle: ViewMode;
  isCoarseDevice: boolean;
  phase: ConnectionPhase;
  softKeys: boolean;
  softKeyboardMode: SoftKeyboardMode;
  stageRef: RefObject<HTMLElement | null>;
  sizeRef: RefObject<{ width: number; height: number }>;
  stats: { width: number; height: number };
  cursorRef: RefObject<Point>;
  lastInputPointRef: RefObject<Point | null>;
  followCursorRef: RefObject<(x: number, y: number) => void>;
  onSystemDismiss: () => void;
}

export function useViewTransform({
  initialViewStyle,
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
  onSystemDismiss,
}: Options) {
  const [viewMode, setViewMode] = useState<ViewMode>(() => initialViewStyle);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ panX: 0, panY: 0 });
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [visibleViewport, setVisibleViewport] = useState<{ width: number; height: number; left: number; top: number } | null>(null);
  const [pageZoomed, setPageZoomed] = useState(false);

  // Orientation change tracking
  const prevLandscapeRef = useRef<boolean | null>(null);

  const remoteW = stats.width > 0 ? stats.width : sizeRef.current.width;
  const remoteH = stats.height > 0 ? stats.height : sizeRef.current.height;
  const viewRef = useRef<ViewTransform>({ scale: 1, panX: 0, panY: 0 });
  const keyboardLayout = useKeyboardViewport({
    enabled: phase === 'live', softKeys, mode: softKeyboardMode, stage: stageRef,
    onSystemDismiss,
    read: () => ({ mode: viewMode, zoom, view: { ...viewRef.current }, remoteW, remoteH,
      anchor: { ...(lastInputPointRef.current ?? cursorRef.current) } }),
    apply: (size, next) => {
      viewRef.current = next.view;
      setBox(previous => previous.w === size.w && previous.h === size.h ? previous : size);
      setViewMode(next.mode);
      setZoom(next.zoom);
      setPan(previous => previous.panX === next.view.panX && previous.panY === next.view.panY
        ? previous : { panX: next.view.panX, panY: next.view.panY });
    },
  });
  const panClampOptions = useMemo(
    () => ({ allowEdgePan: true, edgePadding: DEFAULT_EDGE_PADDING,
      bottomInset: softKeys && !keyboardLayout.viewport ? SOFT_KEYBOARD_BAR_HEIGHT : 0 }),
    [softKeys, keyboardLayout.viewport],
  );

  const view: ViewTransform = computeViewTransform(
    box.w,
    box.h,
    remoteW,
    remoteH,
    viewMode,
    zoom,
    pan,
    panClampOptions,
  );
  viewRef.current = view;

  // ResizeObserver on stage + orientation flip reset to Fit
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      if (keyboardLayout.pending.current) return;
      const w = el.clientWidth;
      const h = el.clientHeight;
      setBox((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
      if (w > 0 && h > 0) {
        const isLandscape = isCoarseDevice && window.screen.orientation
          ? window.screen.orientation.type.startsWith('landscape') : w > h;
        if (prevLandscapeRef.current !== null && prevLandscapeRef.current !== isLandscape) {
          setViewMode('fit');
          setZoom(1);
          setPan({ panX: 0, panY: 0 });
        }
        prevLandscapeRef.current = isLandscape;
      }
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const resetPageZoom = useCallback(() => {
    window.scrollTo(0, 0);
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    if (meta) {
      const original =
        'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
      meta.setAttribute(
        'content',
        'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
      );
      window.setTimeout(() => {
        meta.setAttribute('content', original);
        const vv = window.visualViewport;
        setPageZoomed(vv ? isPageZoomed(vv.scale) : false);
      }, 60);
    } else {
      const vv = window.visualViewport;
      setPageZoomed(vv ? isPageZoomed(vv.scale) : false);
    }
  }, []);

  // visualViewport keyboard inset (--kb) + Step-3 browser-zoom fallback detection
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    let prevZoomed = false;
    let prevInset = -1;
    const syncViewport = () => {
      const zoomed = isPageZoomed(vv.scale);
      setVisibleViewport(zoomed ? { width: vv.width, height: vv.height, left: vv.offsetLeft, top: vv.offsetTop } : null);
      const inset = zoomed && phase === 'live' ? 0 : Math.round(keyboardInset(window.innerHeight, vv.height, vv.offsetTop));
      if (inset !== prevInset) {
        prevInset = inset;
        document.documentElement.style.setProperty('--kb', `${inset}px`);
      }
      if (zoomed !== prevZoomed) {
        setPageZoomed(zoomed);
        if (zoomed) {
          // Attempt automatic viewport scale restoration first; keep banner if browser retains zoom
          resetPageZoom();
        }
        prevZoomed = zoomed;
      }
    };
    syncViewport();
    vv.addEventListener('resize', syncViewport);
    vv.addEventListener('scroll', syncViewport);
    return () => {
      vv.removeEventListener('resize', syncViewport);
      vv.removeEventListener('scroll', syncViewport);
      document.documentElement.style.setProperty('--kb', '0px');
    };
  }, [resetPageZoom, phase]);

  // Scale helper (synchronously updates viewRef so rapid 120Hz pinch/wheel events never read stale state)
  const setScaleAround = useCallback(
    (nextScale: number, anchorX: number, anchorY: number) => {
      const next = computeNextScaleState(
        box.w,
        box.h,
        remoteW,
        remoteH,
        viewRef.current,
        nextScale,
        anchorX,
        anchorY,
        panClampOptions,
      );
      viewRef.current = {
        scale: next.scale,
        panX: next.pan.panX,
        panY: next.pan.panY,
      };
      keyboardLayout.markManual(viewRef.current, next.viewMode, next.zoom);
      setViewMode(next.viewMode);
      setZoom(next.zoom);
      setPan(next.pan);
    },
    [box.w, box.h, remoteW, remoteH, panClampOptions],
  );

  const applyPinchStep = useCallback(
    (
      prevMidX: number,
      prevMidY: number,
      prevDist: number,
      nextMidX: number,
      nextMidY: number,
      nextDist: number,
    ) => {
      const next = computePinchStep(
        box.w,
        box.h,
        remoteW,
        remoteH,
        viewRef.current,
        prevMidX,
        prevMidY,
        prevDist,
        nextMidX,
        nextMidY,
        nextDist,
        panClampOptions,
      );
      viewRef.current = {
        scale: next.scale,
        panX: next.pan.panX,
        panY: next.pan.panY,
      };
      keyboardLayout.markManual(viewRef.current, next.viewMode, next.zoom);
      setViewMode(next.viewMode);
      setZoom(next.zoom);
      setPan(next.pan);
    },
    [box.w, box.h, remoteW, remoteH, panClampOptions],
  );
  const applyPinchStepRef = useRef(applyPinchStep);
  applyPinchStepRef.current = applyPinchStep;

  const panBy = useCallback(
    (dx: number, dy: number, manual = true) => {
      const cur = viewRef.current;
      const curFit = fitScale(box.w, box.h, remoteW, remoteH);
      const nextPan = clampPan(
        box.w,
        box.h,
        remoteW,
        remoteH,
        cur.scale,
        cur.panX + dx,
        cur.panY + dy,
        panClampOptions,
      );
      viewRef.current = { ...cur, panX: nextPan.panX, panY: nextPan.panY };
      if (manual) keyboardLayout.markManual(viewRef.current, 'custom', curFit > 0 ? cur.scale / curFit : 1);
      setPan(nextPan);
      if (viewMode === 'fit') {
        setViewMode('custom');
        setZoom(curFit > 0 ? cur.scale / curFit : 1);
      }
    },
    [box.w, box.h, remoteW, remoteH, viewMode, panClampOptions],
  );

  followCursorRef.current = (x, y) => {
    if (keyboardLayout.active.current) return;
    const view = viewRef.current;
    const point = mapFromRemote(x, y, view);
    const visibleHeight = Math.min(box.h, window.visualViewport?.height ?? box.h) - panClampOptions.bottomInset;
    if (box.w <= 0 || visibleHeight <= 0) return;
    const marginX = Math.min(32, box.w / 4);
    const marginY = Math.min(32, visibleHeight / 4);
    const dx = remoteW * view.scale > box.w
      ? Math.min(box.w - marginX, Math.max(marginX, point.x)) - point.x : 0;
    const dy = remoteH * view.scale > visibleHeight
      ? Math.min(visibleHeight - marginY, Math.max(marginY, point.y)) - point.y : 0;
    if (dx || dy) panBy(dx, dy, false);
  };

  return {
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
  };
}
