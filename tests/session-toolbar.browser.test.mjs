// Start Vite and a dedicated headless Chrome before running this browser regression:
// yarn vite --host 127.0.0.1 --port 4175 --strictPort
// chrome --headless --remote-debugging-port=9224 --user-data-dir=/tmp/rustdesk-toolbar-test
// node --test --test-timeout=30000 tests/session-toolbar.browser.test.mjs
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
const debuggerUrl = 'http://127.0.0.1:9224';
const appUrl = 'http://127.0.0.1:4175/';
const newTab = await fetch(`${debuggerUrl}/json/new?about:blank`, { method: 'PUT' });
assert.ok(newTab.ok, 'Chrome must allow creating a test tab');
const tab = await newTab.json();
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const waiting = new Map();
let id = 0;
socket.onmessage = ({ data }) => {
  const response = JSON.parse(data);
  const request = waiting.get(response.id);
  if (request) {
    waiting.delete(response.id);
    if (response.error) request.reject(response.error);
    else request.resolve(response.result);
  }
};
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  waiting.set(++id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression) {
  for (let i = 0; i < 60; i++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await delay(100);
  }
  throw Error('Timed out: ' + expression);
}
const select = name => `document.querySelector('[data-testid="${name}"]')`;
const list = "document.querySelector('[role=listbox]')";
async function touch(type, touchPoints = []) {
  await cdp('Input.dispatchTouchEvent', { type, touchPoints });
}
async function tap(x, y) {
  await touch('touchStart', [{ x, y }]);
  await touch('touchEnd');
  await delay(120);
}
async function tapElement(el) {
  const point = await evaluate(`(() => { const e = ${el}; const r = e.getBoundingClientRect();
    const x = r.x + r.width / 2, y = r.y + r.height / 2;
    return { x, y, hit: e.contains(document.elementFromPoint(x,y)) };
  })()`);
  assert.equal(point.hit, true, el);
  await tap(point.x, point.y);
}
const sent = () => evaluate("window.sent.filter(e => e.type === 'mouse' || e.type === 'quality')");
const mock = `if (location.protocol === 'http:') localStorage.setItem("rd_web_prefs", JSON.stringify({ idServer: "localhost", peerId: "123456789" }));
window.sent = [];
const BrowserSocket = window.WebSocket;
window.WebSocket = class extends EventTarget {
  static OPEN = 1;
  constructor(url, protocols) {
    super();
    if (!String(url).endsWith('/ws')) return new BrowserSocket(url, protocols);
    this.readyState = 0;
    setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 10);
  }
  send(data) {
    const message = JSON.parse(data);
    window.sent.push(message);
    if (message.type === 'connect') setTimeout(() => {
      for (const reply of [
        { type: 'status', state: 'live' },
        { type: 'resolutions', display: 0, sizes: Array.from({length: 12}, (_, i) => ({width: 800+i*80, height: 600+i*50})) },
      ]) this.onmessage?.({ data: JSON.stringify(reply) });
    }, 10);
  }
  close() { this.readyState = 3; }
};`;
async function connect() {
  await cdp('Page.navigate', { url: appUrl });
  await until('window.sent && ' + select('peer-id'));
  await evaluate(select('connect') + '.click()');
  await until(select('password-confirm-connect'));
  await evaluate(select('password-confirm-connect') + '.click()');
}

async function click(x, y) {
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

try {
  await cdp('Page.enable');
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: mock });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 1, mobile: true });
  await cdp('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await connect();
  await until(select('mobile-dock-expand'));
  await tapElement(select('mobile-dock-expand'));
  await tap(100, 360);
  assert.deepEqual((await sent()).filter(e => e.type === 'mouse').map(e => e.action), ['move', 'down', 'up']);
  console.log('Expanded toolbar: remote tap reaches the gateway.');
  await tapElement(select('dock-display'));
  const fps = select('fps-select');
  await tapElement(fps);
  await until(list);
  assert.equal(await evaluate(fps + '.getAttribute("aria-expanded")'), 'true');
  await tapElement(fps);
  assert.equal(await evaluate(fps + '.getAttribute("aria-expanded")'), 'false');
  await tapElement(fps);
  await tapElement(list + '.lastElementChild');
  assert.equal(await evaluate(fps + '.getAttribute("aria-expanded")'), 'false');
  assert.match(await evaluate(fps + '.textContent'), /60 FPS/);
  assert.equal((await sent()).filter(e => e.type === 'mouse').length, 3);
  console.log('Display dropdown: second tap closes, option selection works, no remote mouse events.');
  await tapElement(fps);
  const before = (await sent()).length;
  await tap(75, 350);
  assert.equal(await evaluate(fps + '.getAttribute("aria-expanded")'), 'false');
  assert.deepEqual((await sent()).slice(before).map(e => e.action), ['move', 'down', 'up']);
  const beforeDrag = (await sent()).length;
  await touch('touchStart', [{ x: 80, y: 345 }]);
  await delay(440);
  await touch('touchMove', [{ x: 130, y: 370 }]);
  await touch('touchMove', [{ x: 165, y: 385 }]);
  await touch('touchEnd');
  await delay(120);
  const dragActions = (await sent()).slice(beforeDrag).map(e => e.action);
  assert.deepEqual(dragActions.slice(0, 2), ['move', 'down']);
  assert.ok(dragActions.slice(2, -1).includes('move'));
  assert.equal(dragActions.at(-1), 'up');

  const fingers = [75, 115, 155].map((x, id) => ({ x, y: 320, id }));
  const beforeScroll = (await sent()).length;
  await touch('touchStart', fingers);
  await touch('touchMove', fingers.map(point => ({ ...point, y: 380 })));
  await touch('touchEnd');
  assert.ok((await sent()).slice(beforeScroll).some(e => e.action === 'wheel'));
  console.log('Display panel: remote taps, drags and three-finger scrolling work outside the panel.');
  await tapElement(select('dock-display'));
  assert.equal(await evaluate(select('session-menu') + ' === null'), true);
  await tapElement(select('dock-collapse'));
  await until(select('mobile-dock-expand'));
  await tap(180, 355);
  assert.deepEqual((await sent()).slice(-3).map(e => e.action), ['move', 'down', 'up']);
  console.log('Collapsed toolbar: remote tap still works.');

  await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await connect();
  await until(select('session-handle'));
  const handle = await evaluate(`(() => {
    const rect = ${select('session-handle')}.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await click(handle.x, handle.y);
  await until(select('toolbar-open-menu'));
  await evaluate(select('toolbar-open-menu') + '.click()');
  await until(select('session-backdrop'));
  assert.equal(await evaluate(select('stage') + '.dataset.remoteActive'), 'false');
  await evaluate(select('session-close') + '.click()');
  await until(select('stage') + '.dataset.remoteActive === "true"');
  console.log('Desktop session menu: opening pauses remote input and closing restores it.');
} finally {
  socket.close();
  const closed = await fetch(`${debuggerUrl}/json/close/${tab.id}`);
  assert.ok(closed.ok, 'Chrome must allow closing the test tab');
}
