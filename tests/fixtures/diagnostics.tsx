import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { DiagnosticOverlay } from '../../src/components/DiagnosticOverlay';
import { computeDiagnosticsSummary, createDiagnosticsState } from '../../src/lib/diagnostics';
import { EMPTY_STATS, createSessionStatsStore } from '../../src/lib/sessionStats';
import '../../src/index.css';

const result = { status: 'running', error: '', checks: [] as string[], violations: [] as string[] };
Object.assign(window, { diagnosticsResult: result });
document.addEventListener('securitypolicyviolation', event => result.violations.push(event.violatedDirective));
const mount = document.createElement('div');
document.body.append(mount);
const root = createRoot(mount);
let now = 0;
let nextTimer = -1;
const timers = new Map<number, () => void>();
const realSetInterval = window.setInterval.bind(window);
const realClearInterval = window.clearInterval.bind(window);
// Advance only the overlay's sampling clock; Chrome still lays out and paints normally.
Object.defineProperty(performance, 'now', { value: () => now });
window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  if (timeout !== 1000 || typeof handler !== 'function') return realSetInterval(handler, timeout, ...args);
  const id = nextTimer--;
  timers.set(id, () => handler(...args));
  return id;
}) as typeof window.setInterval;
window.clearInterval = id => { if (typeof id === 'number' && timers.has(id)) timers.delete(id); else realClearInterval(id); };

let open = true;
let dark = false;
let browserDirect = false;
let pointerEvents = 0;
let stats = { ...EMPTY_STATS };
const statsStore = createSessionStatsStore();
let summary = computeDiagnosticsSummary(createDiagnosticsState(), now);
const select = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const value = (metric: string) => select(`diag-value-${metric}`).textContent;
const line = (metric: string) => select(`diag-chart-${metric}`).querySelector('.diag-chart-line')!.getAttribute('d')!;

function render() {
  statsStore.setStats(stats);
  flushSync(() => root.render(
    <section data-testid="fixture-stage" style={{ position: 'fixed', inset: 0 }}
      onPointerDown={() => { pointerEvents++; }} onPointerUp={() => { pointerEvents++; }}>
      <canvas data-testid="fixture-desktop" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }} />
      {open && <DiagnosticOverlay locale="zh" statsStore={statsStore} summary={summary}
        routeLabel={browserDirect ? 'WebRTC 浏览器直连' : '网关中继'} browserDirect={browserDirect}
        encryptionLabel="已加密" onClose={() => { open = false; render(); }} />}
    </section>,
  ));
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

function step({ fps = 54, bitrate = 2_400_000, rtt = 32, lost = false, fresh = true, idle = false, elapsed = 1000 } = {}) {
  now += elapsed;
  stats = { ...stats, codec: 'h264', width: 1920, height: 1080, renderFps: fps, rxFps: fps,
    bitrate, streamState: idle ? 'idle' : 'active' };
  if (fresh) {
    const seq = summary.totalSent + 1;
    summary = { ...summary, totalSent: seq, currentRttMs: lost ? summary.currentRttMs : rtt,
      history: [...summary.history, { seq, rttMs: lost ? null : rtt, lost }].slice(-24) };
  }
  render();
  flushSync(() => { for (const callback of timers.values()) callback(); });
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
  timerCount: () => timers.size,
} });
window.addEventListener('resize', paint);

async function run() {
  try {
    render();
    check(value('fps') === '—' && value('bitrate') === '—' && value('rtt') === '—', 'Waiting values must remain unknown');
    step({ fps: 60, rtt: 40 });
    check(value('fps') === '60 FPS' && value('rtt') === '40 ms', 'Fresh measurements must appear');
    step({ lost: true });
    check(value('rtt') === '—', 'A lost probe must not reuse the last successful RTT');
    step({ rtt: 65 });
    check((line('rtt').match(/M/g) ?? []).length === 2, 'RTT path must break across a lost probe');
    step({ fresh: false });
    check(value('rtt') === '—', 'No new probe means no new latency measurement');
    step({ fps: 0, bitrate: 0, idle: true });
    check(value('fps') === '0 FPS' && value('bitrate') === '0 b/s', 'Static desktop must display real zero');
    check(select('diagnostic-overlay').textContent!.includes('画面静止'), 'Static desktop must be distinguished from a failure');
    result.checks.push('missing values, static zero, lost and stale RTT');

    for (let index = 0; index < 65; index++) step({ fps: 45 + index % 13, bitrate: 1_500_000 + index % 9 * 180_000, rtt: 24 + index % 7 * 5 });
    const count = Number(select('diag-chart-fps').dataset.samples);
    check(count >= 29 && count <= 31, `History must remain bounded: ${count}`);
    step({ elapsed: 8000, rtt: 70 });
    check((line('fps').match(/M/g) ?? []).length === 2, 'A paused sampling interval must remain a visible gap');
    result.checks.push('bounded history and background-time gaps');

    resetView();
    await new Promise(resolve => setTimeout(resolve, 0));
    check(Number(select('diag-chart-fps').dataset.samples) === 1, `Reopening must start a new chart window: ${select('diag-chart-fps').dataset.samples}`);
    check(value('rtt') === '—', 'Reopening must not display a cached probe as fresh');
    check(timers.size === 1, 'Reopening must release its previous timer');
    result.checks.push('reopen reset and timer cleanup');
    for (let index = 0; index < 30; index++) step({ fps: 52 + Math.round(Math.sin(index * .4) * 6),
      bitrate: 1_700_000 + Math.round(Math.sin(index * .3) * 600_000), rtt: 28 + Math.round(Math.sin(index * .55) * 9) });
    paint();
    check(result.violations.length === 0, 'Fixture must obey production script policy');
    result.status = 'passed';
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
    result.status = 'failed';
  }
}
void run();
