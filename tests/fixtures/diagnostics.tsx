import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useRef } from 'react';
import { DiagnosticOverlay } from '../../src/components/DiagnosticOverlay';
import { computeDiagnosticsSummary, createDiagnosticsState } from '../../src/lib/diagnostics';
import { EMPTY_STATS, createSessionStatsStore } from '../../src/lib/sessionStats';
import { useRemoteKeyboard } from '../../src/hooks/useRemoteKeyboard';
import { DEFAULT_DISPLAY_PREFS } from '../../src/lib/displayPrefs';
import type { ClientMessage } from '../../src/lib/protocol';
import type { ConnectionPhase } from '../../src/types';
import '../../src/index.css';

const result = { status: 'running', error: '', checks: [] as string[], violations: [] as string[] };
Object.assign(window, { diagnosticsResult: result });
document.addEventListener('securitypolicyviolation', event => result.violations.push(event.violatedDirective));
const mount = document.createElement('div');
document.body.append(mount);
const root = createRoot(mount);
let now = 0;
const timers = new Set<number>();
const realSetInterval = window.setInterval.bind(window);
const realClearInterval = window.clearInterval.bind(window);
// Count real interval ownership; the text overlay should create none.
Object.defineProperty(performance, 'now', { value: () => now });
window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  const id = realSetInterval(handler, timeout, ...args);
  timers.add(id);
  return id;
}) as typeof window.setInterval;
window.clearInterval = id => { if (typeof id === 'number') timers.delete(id); realClearInterval(id); };

let open = true;
let dark = false;
let browserDirect = false;
let pointerEvents = 0;
const remoteKeys: ClientMessage[] = [];
const send = (message: ClientMessage) => { remoteKeys.push(message); };
const closeChrome = () => {};
let stats = { ...EMPTY_STATS };
const statsStore = createSessionStatsStore();
let summary = computeDiagnosticsSummary(createDiagnosticsState(), now);
const select = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const value = (metric: string) => select(`diag-value-${metric}`).textContent;


function Fixture() {
  const chromeRef = useRef({ menu: false, dialog: false });
  const phaseRef = useRef<ConnectionPhase>('live');
  const displayPrefsRef = useRef(DEFAULT_DISPLAY_PREFS);
  useRemoteKeyboard({ send, closeChrome, chromeRef, phaseRef, displayPrefsRef,
    shortcutModifier: 'Control', showCtrlAltDel: true });
  return (
    <section data-testid="fixture-stage" style={{ position: 'fixed', inset: 0 }}
      onPointerDown={() => { pointerEvents++; }} onPointerUp={() => { pointerEvents++; }}>
      <canvas data-testid="fixture-desktop" tabIndex={0} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {open && <DiagnosticOverlay locale="zh" statsStore={statsStore} summary={summary}
        routeLabel={browserDirect ? 'WebRTC 浏览器直连' : '网关中继'} browserDirect={browserDirect}
        onClose={() => { open = false; render(); }} />}
    </section>
  );
}

function render() {
  statsStore.setStats(stats);
  flushSync(() => root.render(<Fixture />));
}

function paint() {
  const canvas = select('fixture-desktop') as HTMLCanvasElement;
  canvas.width = innerWidth;
  canvas.height = innerHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = dark ? '#17222d' : '#f6f8fb';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = dark ? '#253848' : '#e3edf5';
  for (let y = 0; y < canvas.height; y += 64) {
    ctx.fillRect(0, y, canvas.width, 1);
  }
  const x = Math.max(20, innerWidth * .15);
  const y = Math.max(205, innerHeight * .25);
  const width = Math.min(820, innerWidth - x * 2);
  const height = Math.min(450, innerHeight - y - 55);
  ctx.fillStyle = dark ? '#203345' : '#fff';
  ctx.fillRect(x, y, width, height);
  ctx.fillStyle = dark ? '#31485c' : '#d9e6f0';
  ctx.fillRect(x, y, width, 34);
  ctx.fillStyle = dark ? '#d8e6f0' : '#273d52';
  ctx.font = '13px sans-serif';
  ctx.fillText('Remote workspace', x + 16, y + 22);
  ctx.fillText('Connected desktop · Preview content', x + 20, y + 78);
  for (let row = 0; row < 6 && row * 34 + 110 < height; row++) {
    ctx.fillStyle = dark ? '#3c5264' : '#dce7ef';
    ctx.fillRect(x + 20, y + 108 + row * 34, width * (.65 - (row % 3) * .1), 7);
  }
}

function step({ fps = 54, bitrate = 2_400_000, rtt = 32, lost = false, fresh = true, idle = false,
  jitterMs = 3, packetLossPct = 0, decodeLatencyMs = 8, elapsed = 1000, inFlightFrames = 0, oldestFrameAgeMs = 0 } = {}) {
  now += elapsed;
  stats = { ...stats, codec: 'h264', width: 1920, height: 1080, renderFps: fps, rxFps: fps,
    bitrate, decodeLatencyMs, streamState: idle ? 'idle' : 'active', inFlightFrames, oldestFrameAgeMs };
  const seq = summary.totalSent + 1;
  summary = { ...summary, totalSent: seq, avgRttMs: rtt, jitterMs, packetLossPct };
  if (fresh) {
    summary = { ...summary, totalSent: seq, currentRttMs: lost ? summary.currentRttMs : rtt,
      history: [...summary.history, { seq, rttMs: lost ? null : rtt, lost }].slice(-24) };
  }
  render();
}

function resetView() {
  open = false;
  render();
  open = true;
  render();
}

Object.assign(window, { diagnosticsFixture: {
  paint, step, resetView,
  setTheme(next: boolean) { dark = next; document.documentElement.dataset.theme = dark ? 'dark' : 'light'; paint(); },
  setDirect(next: boolean) { browserDirect = next; render(); },
  pointerCount: () => pointerEvents,
  keyCount: () => remoteKeys.length,
  timerCount: () => timers.size,
} });
window.addEventListener('resize', paint);

async function run() {
  try {
    render();
    check(value('fps') === '—' && value('bitrate') === '—' && value('rtt') === '—', 'Waiting values must remain unknown');
    check(select('diag-codec').textContent === '—', 'Unknown codec must remain unknown');
    check(select('diag-picture-state').getAttribute('aria-label') === '正在评估连接质量', 'Initial status icon must describe waiting');
    check(select('diag-picture-state').textContent === '', 'Picture status must use an icon without explanatory text');
    check(!document.querySelector('.diag-trend, details, [data-testid="diag-collapse"]'), 'Text details must not contain charts or expandable sections');
    step({ fps: 60, rtt: 40 });
    check(value('fps') === '60 帧/秒' && value('rtt') === '40 ms', 'Fresh measurements must use readable Chinese units');
    check(select('diag-codec').textContent === 'h264', 'Current codec must be displayed');
    check(select('diag-picture-state').dataset.state === 'good', 'Active output must use its normal status icon');
    check(select('diag-rtt').textContent?.startsWith('网关往返'), 'Gateway latency must name its actual endpoint');
    step({ lost: true });
    check(value('rtt') === '—', 'A lost probe must not reuse the last successful RTT');
    step({ rtt: 65 });
    check(value('rtt') === '65 ms', 'A later successful probe must restore latency');
    step({ fresh: false });
    check(value('rtt') === '—', 'An outstanding probe must not reuse the previous latency');
    step({ fps: 0, bitrate: 0, idle: true });
    check(value('fps') === '0 帧/秒' && value('bitrate') === '0 b/s', 'An idle desktop must display real zero');
    check(select('diag-picture-state').dataset.state === 'good', 'A connected idle picture retains the normal signal state');
    check(select('diag-picture-state').getAttribute('aria-label') === '连接质量良好', 'An idle icon must avoid claiming the remote desktop is necessarily still');
    for (const metrics of [{ rtt: 80 }, { jitterMs: 20 }, { packetLossPct: 1 }, { decodeLatencyMs: 50 }]) {
      step(metrics);
      check(select('diag-picture-state').dataset.state === 'fair', 'Moderate network or decode issues must reduce quality');
    }
    for (const metrics of [{ rtt: 200 }, { jitterMs: 50 }, { packetLossPct: 5 }, { decodeLatencyMs: 100 }]) {
      step(metrics);
      check(select('diag-picture-state').dataset.state === 'poor', 'Severe network or decode issues must show poor quality');
    }
    step({ rtt: 20, jitterMs: 0, decodeLatencyMs: 0 });
    check(select('diag-picture-state').dataset.state === 'good', 'Recovered metrics must restore good quality');
    step({ fps: 0, bitrate: 0, idle: true, inFlightFrames: 5, oldestFrameAgeMs: 450 });
    check(select('diag-picture-state').getAttribute('aria-label') === '画面恢复中', 'Decode backlog must override idle status');
    check(select('diag-picture-state').dataset.state === 'recovering', 'A pending picture must use recovery status');
    check(document.querySelector('.diag-header')?.firstElementChild === select('diag-picture-state'), 'Signal status must lead the header');
    result.checks.push('compact text, accessible signal status, real zero and fresh/lost/pending RTT');

    resetView();
    await new Promise(resolve => setTimeout(resolve, 0));
    check(value('rtt') === '—', 'Reopening must not display a cached probe as fresh');
    check(timers.size === 0, 'Text details must not own an extra sampling interval');
    step({ fps: 47, bitrate: 2_100_000, rtt: 26 });
    paint();
    check(result.violations.length === 0, 'Fixture must obey production script policy');
    result.checks.push('reopen freshness and zero additional timers');
    result.status = 'passed';
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.status = 'failed';
  }
}
void run();
