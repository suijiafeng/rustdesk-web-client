import { Profiler, useEffect, useRef, useState } from 'react';
import { createRoot, flushSync } from 'react-dom/profiling';
import { useVideoPipeline } from '../../src/hooks/useVideoPipeline';
import { useRemotePointer } from '../../src/hooks/useRemotePointer';
import { RemoteStage } from '../../src/components/RemoteStage';
import { DiagnosticOverlay } from '../../src/components/DiagnosticOverlay';
import { SessionMenu } from '../../src/components/SessionMenu';
import { DEFAULT_DISPLAY_PREFS } from '../../src/lib/displayPrefs';
import { computeDiagnosticsSummary, createDiagnosticsState } from '../../src/lib/diagnostics';
import { EMPTY_STATS } from '../../src/lib/sessionStats';
import { recordRenderedFrame } from '../../src/lib/stats';
import { mapToRemote, type ViewTransform } from '../../src/lib/mapping';
import '../../src/index.css';

const result = { status: 'running', error: '', checks: [] as string[], counts: {} };
Object.assign(window, { presentationResult: result });
let now = 10_000;
Object.defineProperty(performance, 'now', { value: () => now });
const timers = new Map<number, () => void>();
let timerId = -1;
const realSetInterval = window.setInterval.bind(window);
const realClearInterval = window.clearInterval.bind(window);
window.setInterval = ((handler: TimerHandler, interval?: number, ...args: unknown[]) => {
  if (interval !== 250 || typeof handler !== 'function') return realSetInterval(handler, interval, ...args);
  const id = timerId--;
  timers.set(id, () => handler(...args));
  return id;
}) as typeof window.setInterval;
window.clearInterval = id => { if (typeof id === 'number' && timers.has(id)) timers.delete(id); else realClearInterval(id); };
const counters = { app: 0, stage: 0, diagnostics: 0, menu: 0, debug: 0 };
const noop = () => {};
const summary = computeDiagnosticsSummary(createDiagnosticsState(), now);
const mount = document.createElement('div');
document.body.append(mount);
const root = createRoot(mount);
let api: {
  video: ReturnType<typeof useVideoPipeline>;
  placeCursor: (x: number, y: number) => void;
  setView: (view: ViewTransform) => void;
  setPanels: (open: boolean) => void;
  setEnlarge: (enabled: boolean) => void;
  setViewport: (box: { left: number; top: number; width: number; height: number }) => void;
  debugDecoded: number;
};
const check = (ok: unknown, message: string) => { if (!ok) throw new Error(message); };
const near = (actual: number, expected: number, message: string) => check(Math.abs(actual - expected) < .1, `${message}: ${actual} != ${expected}`);
const element = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;

function Fixture() {
  counters.app++;
  const video = useVideoPipeline({ phase: 'live', send: noop });
  const [view, setView] = useState<ViewTransform>({ scale: 1, panX: 0, panY: 0 });
  const [panels, setPanels] = useState(true);
  const [enlarge, setEnlarge] = useState(false);
  const [viewport, setViewport] = useState({ left: 0, top: 0, width: 1000, height: 700 });
  const [touchMode, setTouchMode] = useState(false);
  const stageRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorElRef = useRef<HTMLDivElement>(null);
  const cursorCanvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef({ x: 300, y: 200 });
  const lastInputPointRef = useRef(null);
  const followCursorRef = useRef(noop);
  const viewRef = useRef(view); viewRef.current = view;
  const displayPrefsRef = useRef({ ...DEFAULT_DISPLAY_PREFS, followRemoteCursor: false });
  const chromeRef = useRef({ menu: false, dialog: false });
  const applyPinchStepRef = useRef(noop);
  const captureRef = useRef<HTMLInputElement>(null);
  const captureComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const [cursorShape] = useState(() => ({ pixels: new ImageData(16, 12), hotX: 3, hotY: 4 }));
  const pointer = useRemotePointer({ isCoarseDevice: false, touchMode, setTouchMode,
    isMobileViewport: false, isTouchLayout: false, remoteInput: true, send: noop,
    displayPrefsRef, stageRef, canvasRef, cursorElRef, cursorCanvasRef, cursorShape,
    sizeRef: video.sizeRef, cursorRef, lastInputPointRef, followCursorRef, viewRef, view,
    remoteW: 1280, remoteH: 720, panBy: noop, setScaleAround: noop, applyPinchStepRef,
    openSoftKeyboard: noop, softKeys: false, textCursor: false, chromeRef, closeChrome: noop,
    focusDesktopCapture: noop, toolbarExpanded: false, toolbarPinned: false, setToolbarExpanded: noop,
  });
  api = { video, placeCursor: pointer.placeCursor, setView, setPanels, setEnlarge, setViewport, debugDecoded: api?.debugDecoded ?? 0 };
  useEffect(() => {
    const update = () => { counters.debug++; api.debugDecoded = video.statsStore.getSnapshot().decoded; };
    update();
    return video.statsStore.subscribe(update);
  }, [video.statsStore]);
  counters.stage++;
  return <RemoteStage stageRef={stageRef} live stageViewport={viewport} keyboardAvoiding={viewport.height < 600}
    remoteInput pointer={pointer}
    canvas={{ canvasRef, remoteW: video.videoLayout.width || 1280, remoteH: video.videoLayout.height || 720, view }}
    cursor={{ cursorElRef, cursorCanvasRef, cursorShape, showRemoteCursor: true, enlargeCursor: enlarge }}
    capture={{ captureRef, captureComposingRef, lastCompositionEndAtRef, displayPrefsRef, sendText: noop }}>
    {panels && <Profiler id="diagnostics" onRender={() => counters.diagnostics++}>
      <DiagnosticOverlay locale="zh" statsStore={video.statsStore} summary={summary}
        routeLabel="网关中继" onClose={noop} />
    </Profiler>}
    {panels && <Profiler id="menu" onRender={() => counters.menu++}>
      <SessionMenu statsStore={video.statsStore} locale="zh" mobileLayout={false} mobilePanel="display"
        phase="live" peer={null} decoderError="" display={0} touchMode={false} viewOnly={false}
        clipboardSync={false} clipboardAllowed audioEnabled={false} followWindow={false}
        sizes={[{ width: 1280, height: 720 }]} rtt={0} quality="balanced" customQuality={100}
        targetFps={30} preferredCodec="auto" privacyEnabled={false} privacyPending={false} reverseScroll={false}
        onToggleClipboardSync={noop} onNotify={noop} onToggleAudio={noop} onToggleFollowWindow={noop}
        onResolution={noop} onTogglePrivacy={noop} onClose={noop} onOpenConnection={noop} onRestart={noop}
        onDisconnect={noop} onToggleTouchMode={noop} onReverseScrollChange={noop}
        onSwitchDisplay={noop} onQuickKey={noop} onChangeQuality={noop} />
    </Profiler>}
  </RemoteStage>;
}

function tick() {
  flushSync(() => {
    for (let frame = 0; frame < 8; frame++) {
      now += 31.25;
      api.video.noteFrame('h264', 1280, 720, 1000, 5);
      recordRenderedFrame(api.video.frameStatsRef.current, now);
      api.video.statAccRef.current.decoded++;
    }
    for (const timer of timers.values()) timer();
  });
}

async function run() {
  try {
    flushSync(() => root.render(<Fixture />));
    tick();
    const before = { ...counters };
    for (let i = 0; i < 24; i++) tick();
    check(counters.app === before.app && counters.stage === before.stage, 'Telemetry updates must not render the parent or desktop stage');
    check(counters.diagnostics >= before.diagnostics + 24 && counters.menu >= before.menu + 24, 'Open diagnostic and menu subscribers must update');
    check(api.debugDecoded === 200, 'Debug listeners must receive current telemetry without a parent render');
    check(element('diag-value-fps').textContent === '32 帧/秒', 'Actual hook statistics must reach the overlay');
    result.checks.push('24 telemetry publications update open subscribers without parent/stage renders');
    flushSync(() => api.setPanels(false));
    const hidden = { ...counters };
    for (let i = 0; i < 12; i++) tick();
    check(counters.app === hidden.app && counters.diagnostics === hidden.diagnostics && counters.menu === hidden.menu,
      'Closed panels must not retain React subscriptions');
    flushSync(() => api.video.setStats(prev => ({ ...prev, width: 1440, height: 900 })));
    check(counters.app === hidden.app + 1, 'A real resolution change must still update layout');
    flushSync(() => api.video.setStats(EMPTY_STATS));
    check(api.video.statsStore.getSnapshot().streamState === 'waiting', 'Disconnect reset must clear sampled values');
    result.checks.push('closed subscribers stop rendering, layout changes and reset remain observable');

    for (const [scale, panX, panY, enlarged] of [[.5, 100, 60, false], [1.75, -20, 35, true], [3, -500, -200, false]] as const) {
      const viewport = { left: 41, top: 53, width: 900, height: 400 };
      flushSync(() => { api.setViewport(viewport); api.setView({ scale, panX, panY }); api.setEnlarge(enlarged); });
      api.placeCursor(300, 200);
      const canvas = element('canvas');
      const rect = canvas.getBoundingClientRect();
      near(rect.left, viewport.left + panX, 'Canvas X'); near(rect.top, viewport.top + panY, 'Canvas Y');
      near(rect.width, 1280 * scale, 'Canvas scaled width'); near(rect.height, 720 * scale, 'Canvas scaled height');
      check(canvas.style.width === '1280px' && canvas.style.left === '0px', 'Pan and zoom must use transform instead of changing CSS bounds');
      const point = mapToRemote(panX + 300.5 * scale, panY + 200.5 * scale, 1280, 720, { scale, panX, panY });
      check(point?.x === 300 && point?.y === 200, 'Input coordinates must round-trip through the unchanged transform');
      const cursor = element('remote-cursor');
      const pixels = cursor.querySelector('canvas')!.getBoundingClientRect();
      const size = enlarged ? 2 : 1;
      near(pixels.left, viewport.left + panX + 300.5 * scale - 3 * size, 'Cursor hotspot X');
      near(pixels.top, viewport.top + panY + 200.5 * scale - 4 * size, 'Cursor hotspot Y');
      near(pixels.width, 16 * size, 'Cursor magnification');
      check(cursor.style.transform.startsWith('translate3d') && cursor.style.left === '0px', 'Cursor placement must retain its own translation');
      check(element('stage').dataset.keyboardAvoiding === 'true', 'Reduced keyboard viewport must remain active');
    }
    result.checks.push('canvas transforms, cursor hotspots and enlargement, inverse input mapping and keyboard viewport');
    result.counts = { ...counters };
    flushSync(() => root.unmount());
    check(timers.size === 0, 'Unmount must stop statistics sampling');
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = error instanceof Error ? error.message : String(error);
  }
}
void run();
