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
const hasPrivacySwitch = `Array.from(${select('session-menu')}.querySelectorAll('[role="switch"]'))
  .some(input => /Privacy mode|隐私模式/.test(input.closest('label').textContent))`;
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
    if (message.type === 'ping') setTimeout(() => this.onmessage?.({ data: JSON.stringify({
      type: 'pong', seq: message.seq, clientTs: message.clientTs, serverTs: Date.now(),
      gatewayVideo: { queuedBytes: 131072, droppedFrames: 42, recovering: true },
    }) }), 10);
    if (message.type === 'connect') setTimeout(() => {
      for (const reply of [
        { type: 'peer', platform: new URLSearchParams(location.search).get('platform') ?? 'Windows',
          hostname: 'Test host', currentDisplay: 0, displays: [], privacyAllowed: true },
        { type: 'status', state: 'live' },
        { type: 'resolutions', display: 0, sizes: Array.from({length: 12}, (_, i) => ({width: 800+i*80, height: 600+i*50})) },
      ]) this.onmessage?.({ data: JSON.stringify(reply) });
    }, 10);
  }
  close() { this.readyState = 3; }
};`;
async function connect(platform = 'Windows', diagnostics = false) {
  const url = new URL(appUrl);
  url.searchParams.set('platform', platform);
  if (diagnostics) url.searchParams.set('diag', '1');
  await cdp('Page.navigate', { url: url.href });
  await until('window.sent && ' + select('peer-id'));
  await evaluate(select('connect') + '.click()');
  await until(select('password-confirm-connect'));
  await evaluate(select('password-confirm-connect') + '.click()');
}

async function click(x, y) {
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

async function openDesktopToolbar() {
  await until(select('session-handle'));
  const handle = await evaluate(`(() => {
    const rect = ${select('session-handle')}.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  await click(handle.x, handle.y);
  await until(select('toolbar-open-menu'));
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
  await until(select('mobile-dock-expand'));
  console.log('Expanded toolbar: an outside tap collapses the toolbar and reaches the gateway.');
  await tapElement(select('mobile-dock-expand'));
  await tapElement(select('dock-menu'));
  assert.equal(await evaluate(hasPrivacySwitch), false);
  assert.equal(await evaluate(select('more-connection-details') + ' === null'), true);
  assert.equal(await evaluate(select('dock-gestures') + ' === null'), true);
  await tapElement(select('dock-more'));
  await tapElement(select('more-gestures'));
  await until(select('gesture-guide'));
  assert.equal(await evaluate(select('session-reverse-scroll') + ' === null'), true);
  await tapElement(select('gestures-back'));
  await tapElement(select('more-connection-details'));
  await until(select('diagnostic-overlay'));
  await tapElement(select('diag-close'));
  await tapElement(select('mobile-dock-expand'));
  console.log('More: gesture guide, back navigation and connection details verified.');
  await tapElement(select('dock-display'));
  assert.equal(await evaluate(hasPrivacySwitch), true);
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
  await until(select('mobile-dock-expand'));
  assert.equal(await evaluate(list + ' === null'), true);
  assert.equal(await evaluate(select('session-menu') + ' === null'), true);
  assert.deepEqual((await sent()).slice(before).map(e => e.action), ['move', 'down', 'up']);
  await tapElement(select('mobile-dock-expand'));
  await tapElement(select('dock-display'));
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
  const threeFingerScroll = async () => {
    const beforeScroll = (await sent()).length;
    await touch('touchStart', fingers);
    await touch('touchMove', fingers.map(point => ({ ...point, y: 380 })));
    await touch('touchEnd');
    return (await sent()).slice(beforeScroll).find(e => e.action === 'wheel');
  };
  const originalScroll = await threeFingerScroll();
  assert.ok(originalScroll?.y);
  assert.equal(await evaluate('Boolean(' + select('session-menu') + ')'), true);
  console.log('Display panel: outside taps dismiss it, while drags and three-finger scrolling leave it open.');
  await tapElement(select('dock-display'));
  assert.equal(await evaluate(select('session-menu') + ' === null'), true);
  await tapElement(select('dock-collapse'));
  await until(select('mobile-dock-expand'));
  await tap(180, 355);
  assert.deepEqual((await sent()).slice(-3).map(e => e.action), ['move', 'down', 'up']);
  console.log('Collapsed toolbar: remote tap still works.');

  const reverseScroll = select('session-reverse-scroll');
  await tapElement(select('mobile-dock-expand'));
  await tapElement(select('dock-menu'));
  const originalPreference = await evaluate(reverseScroll + '.textContent');
  await tapElement(reverseScroll);
  await until(list);
  const alternatives = await evaluate(`Array.from(${list}.children, option => option.textContent)`);
  assert.ok(
    JSON.stringify(alternatives) === JSON.stringify(['自然', '反转']) ||
    JSON.stringify(alternatives) === JSON.stringify(['Natural', 'Reverse']),
  );
  const otherDirection = `${list}.querySelector('[aria-selected="false"]')`;
  const otherPreference = await evaluate(otherDirection + '.textContent');
  await tapElement(otherDirection);
  assert.equal(await evaluate(reverseScroll + '.textContent'), otherPreference);
  await tapElement(select('dock-menu'));
  const reversedScroll = await threeFingerScroll();
  assert.equal(reversedScroll?.y, -originalScroll.y);

  const softbar = select('softbar');
  const keyboardSwitch = select('soft-keyboard-switch');
  const virtualKeyboard = select('virtual-keyboard');
  const toolbarTop = `${softbar}.getBoundingClientRect().top`;
  await evaluate(`(() => {
    const viewport = window.visualViewport;
    let height = viewport.height;
    Object.defineProperty(viewport, 'height', { get: () => height });
    window.setTestViewportHeight = next => {
      height = next;
      viewport.dispatchEvent(new Event('resize'));
    };
  })()`);
  const fullHeight = await evaluate('window.visualViewport.height');
  await tapElement(select('dock-keyboard'));
  await until(`${softbar}?.dataset.keyboardMode === 'system'`);
  assert.equal(await evaluate('document.activeElement === ' + select('soft-input')), true);
  await evaluate(`window.setTestViewportHeight(${fullHeight - 260})`);
  await until(`${select('stage')}.dataset.keyboardAvoiding === 'true'`);
  const systemKeyboardTop = await evaluate(toolbarTop);

  await tapElement(keyboardSwitch);
  assert.equal(await evaluate(softbar + '.dataset.keyboardMode'), 'virtual');
  assert.equal(await evaluate(select('soft-input') + ' === null'), true);
  assert.equal(await evaluate(toolbarTop), systemKeyboardTop);
  for (const remaining of [180, 90, 0]) {
    await evaluate(`window.setTestViewportHeight(${fullHeight - remaining})`);
    await delay(35);
    assert.equal(await evaluate(toolbarTop), systemKeyboardTop);
  }
  assert.equal(await evaluate(virtualKeyboard + '.getBoundingClientRect().height'), 260);

  assert.deepEqual(await evaluate(`Array.from(${virtualKeyboard}.children, row => row.children.length)`), [14, 14, 13, 12, 8]);
  assert.ok(await evaluate(`[...(${virtualKeyboard}).querySelectorAll('button')].every(key => {
    const { left, right } = key.getBoundingClientRect();
    return left >= 0 && right <= window.innerWidth;
  })`));

  const keyEvents = "window.sent.filter(event => event.type === 'key')";
  const firstVirtualEvent = await evaluate(keyEvents + '.length');
  const letterA = `${virtualKeyboard}.querySelector('[data-key-feedback="letter-a"]')`;
  const letterPoint = await evaluate(`(() => {
    const rect = ${letterA}.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  const idleColor = await evaluate(`getComputedStyle(${letterA}).backgroundColor`);
  await touch('touchStart', [letterPoint]);
  assert.equal(await evaluate(letterA + '.dataset.keyPressed'), 'true');
  assert.notEqual(await evaluate(`getComputedStyle(${letterA}).backgroundColor`), idleColor);
  await touch('touchEnd');
  assert.equal(await evaluate(letterA + '.dataset.keyPressed'), 'true');
  await until(letterA + '.dataset.keyPressed === undefined');
  await tapElement(select('soft-mod-ctrl'));
  await tapElement(select('soft-mod-shift'));
  await tapElement(`${virtualKeyboard}.querySelector('[data-key="Enter"]')`);
  await tapElement(`${virtualKeyboard}.querySelector('[data-key-feedback="letter-["]')`);
  await tapElement(`${virtualKeyboard}.querySelector('[data-key="Shift"]')`);
  const numberOne = `${virtualKeyboard}.querySelector('[data-key-feedback="letter-1"]')`;
  assert.equal(await evaluate(numberOne + '.getAttribute("aria-label")'), '!');
  await tapElement(numberOne);
  await tapElement(`${virtualKeyboard}.querySelector('[data-key="CapsLock"]')`);
  const virtualEvents = (await evaluate(keyEvents)).slice(firstVirtualEvent);
  assert.deepEqual(virtualEvents.map(event => [event.action, event.control ?? event.chr]), [
    ['down', 'a'], ['up', 'a'],
    ['down', 'Control'], ['down', 'Shift'], ['down', 'Enter'],
    ['up', 'Enter'], ['up', 'Shift'], ['up', 'Control'],
    ['down', '['], ['up', '['],
    ['down', '!'], ['up', '!'],
    ['down', 'CapsLock'], ['up', 'CapsLock'],
  ]);
  assert.equal(await evaluate(select('soft-input') + ' === null'), true);

  await tapElement(keyboardSwitch);
  assert.equal(await evaluate(softbar + '.dataset.keyboardMode'), 'system');
  assert.equal(await evaluate('document.activeElement === ' + select('soft-input')), true);
  assert.equal(await evaluate(toolbarTop), systemKeyboardTop);
  for (const remaining of [90, 180, 260]) {
    await evaluate(`window.setTestViewportHeight(${fullHeight - remaining})`);
    await delay(35);
    assert.equal(await evaluate(toolbarTop), systemKeyboardTop);
  }
  await tapElement(select('soft-hide'));
  await evaluate(`window.setTestViewportHeight(${fullHeight})`);
  await until(select('mobile-dock-expand'));
  console.log('Keyboard: QWERTY rows, shifted punctuation, native focus and stable height verified.');

  await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await connect();
  await openDesktopToolbar();
  assert.equal(await evaluate('Boolean(' + select('toolbar-cad') + ')'), true);
  await evaluate(select('toolbar-keyboard') + '.click()');
  await until(select('soft-mod-win'));
  assert.equal(await evaluate(select('soft-mod-win') + '.textContent'), 'Win');
  assert.equal(await evaluate(select('soft-mod-alt') + '.textContent'), 'Alt');
  await evaluate(select('soft-hide') + '.click()');
  await evaluate(select('toolbar-open-menu') + '.click()');
  await until(select('session-backdrop'));
  assert.equal(await evaluate(hasPrivacySwitch), false);
  await evaluate(select('menu-tab-display') + '.click()');
  assert.equal(await evaluate(hasPrivacySwitch), true);
  await evaluate(select('menu-tab-control') + '.click()');
  assert.equal(await evaluate(reverseScroll + '.textContent'), otherPreference);
  await evaluate(reverseScroll + '.click()');
  await until(list);
  await evaluate(otherDirection + '.click()');
  assert.equal(await evaluate(reverseScroll + '.textContent'), originalPreference);
  console.log('Scroll direction: three-finger wheel output reverses, and the preference survives reconnecting.');
  assert.equal(await evaluate(select('stage') + '.dataset.remoteActive'), 'false');
  await evaluate(select('session-close') + '.click()');
  await until(select('stage') + '.dataset.remoteActive === "true"');
  console.log('Windows: Win and Alt labels, Ctrl+Alt+Del, and desktop menu input isolation verified.');

  await connect('Mac OS', true);
  const diagnostics = select('diagnostic-overlay');
  await until(`${diagnostics}?.textContent.includes('128 KiB')`);
  assert.ok(await evaluate(`${diagnostics}.textContent.includes('42')`));
  await openDesktopToolbar();
  assert.equal(await evaluate(select('toolbar-cad') + ' === null'), true);
  await evaluate(select('toolbar-keyboard') + '.click()');
  await until(select('soft-mod-win'));
  assert.equal(await evaluate(select('soft-mod-win') + '.textContent'), 'Command');
  assert.equal(await evaluate(select('soft-mod-alt') + '.textContent'), 'Option');
  await evaluate(select('soft-mod-win') + '.click()');
  await cdp('Input.insertText', { text: 'c' });
  const keys = await evaluate("window.sent.filter(event => event.type === 'key')");
  assert.deepEqual(keys.map(key => [key.action, key.control ?? key.chr]), [
    ['down', 'Meta'], ['down', 'c'], ['up', 'c'], ['up', 'Meta'],
  ]);
  console.log('macOS: Command and Option labels and Command+C events verified.');

  assert.equal(await evaluate(select('soft-chord-toggle') + ' === null'), true);
  assert.ok(await evaluate(`${select('soft-key-strip')}.querySelector('button[aria-label="Page Down"]') !== null`));
  await evaluate(select('soft-hide') + '.click()');
} finally {
  socket.close();
  const closed = await fetch(`${debuggerUrl}/json/close/${tab.id}`);
  assert.ok(closed.ok, 'Chrome must allow closing the test tab');
}
