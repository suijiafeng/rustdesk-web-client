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
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
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
const css = (element, property) => evaluate(`getComputedStyle(${element}).${property}`);
async function setSystemTheme(theme) {
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: theme }] });
  await until(`document.documentElement.dataset.theme === '${theme}'`);
}
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
const mock = `if (location.protocol === 'http:') localStorage.setItem("rd_web_prefs", JSON.stringify({
  idServer: "localhost", peerId: new URLSearchParams(location.search).get('peer') ?? "123456789",
  forceRelay: new URLSearchParams(location.search).has('forceRelay'),
}));
window.sent = [];
const tokenTest = new URLSearchParams(location.search).has('tokenTest');
const webRtcTest = new URLSearchParams(location.search).has('webRtcTest');
window.openedConnections = [];
if (tokenTest || webRtcTest) {
  const browserFetch = window.fetch.bind(window);
  window.fetch = (input, options) => input === '/api/health'
    ? Promise.resolve(Response.json({ authRequired: tokenTest, webRtcEnabled: webRtcTest }))
    : browserFetch(input, options);
}
const BrowserSocket = window.WebSocket;
window.WebSocket = class extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  constructor(url, protocols) {
    super();
    this.pathname = new URL(url, location.href).pathname;
    if (this.pathname !== '/ws' && !(webRtcTest && this.pathname === '/ws/webrtc')) {
      return new BrowserSocket(url, protocols);
    }
    window.openedConnections.push(this.pathname);
    this.readyState = 0;
    setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 10);
  }
  send(data) {
    const message = JSON.parse(data);
    if (this.pathname === '/ws/webrtc') {
      if (message.type === 'offer') {
        window.webRtcOffer = message;
        window.rejectWebRtcOffer = () => this.onmessage?.({
          data: JSON.stringify({ type: 'error', message: 'Incompatible ID server' }),
        });
      }
      return;
    }
    window.sent.push(message);
    if (message.type === 'ping') setTimeout(() => this.onmessage?.({ data: JSON.stringify({
      type: 'pong', seq: message.seq, clientTs: message.clientTs, serverTs: Date.now(),
      gatewayVideo: { queuedBytes: 131072, droppedFrames: 42, recovering: true },
    }) }), 10);
    if (message.type === 'connect') setTimeout(() => {
      if (new URLSearchParams(location.search).has('requireToken') || (tokenTest && message.token !== 'test-gateway-token')) {
        this.onmessage?.({ data: JSON.stringify({ type: 'status', state: 'error', detail: 'gateway token required' }) });
        return;
      }
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
  await cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await connect();
  await until(select('mobile-dock-expand'));
  await until("document.documentElement.dataset.theme === 'dark'");
  await tapElement(select('mobile-dock-expand'));
  await tap(100, 360);
  assert.deepEqual((await sent()).filter(e => e.type === 'mouse').map(e => e.action), ['move', 'down', 'up']);
  await until(select('mobile-dock-expand'));
  console.log('Expanded toolbar: an outside tap collapses the toolbar and reaches the gateway.');
  await tapElement(select('mobile-dock-expand'));
  await tapElement(select('dock-menu'));
  assert.equal(await evaluate(hasPrivacySwitch), false);
  const connectionDetails = select('screen-connection-details');
  assert.equal(await evaluate(connectionDetails + ' === null'), true);
  assert.equal(await evaluate(select('dock-more') + ' === null'), true);
  assert.equal(await evaluate(select('action-gestures') + ' === null'), true);
  assert.equal(await evaluate(select('gesture-guide') + ' === null'), true);
  await until(select('session-reverse-scroll'));
  await tapElement(select('dock-display'));
  await tapElement(connectionDetails);
  await until(select('diagnostic-overlay'));
  await tapElement(select('diag-close'));
  await tapElement(select('mobile-dock-expand'));
  console.log('Tools: connection details under Screen verified, with no More or gesture guide.');
  await tapElement(select('dock-display'));
  assert.equal(await evaluate(hasPrivacySwitch), true);
  const fps = select('fps-select');
  await tapElement(fps);
  await until(list);
  assert.equal(await evaluate(fps + '.getAttribute("aria-expanded")'), 'true');
  const screenPanel = select('session-menu');
  const selectedOption = `${list}.querySelector('[aria-selected="true"]')`;
  assert.equal(await css(screenPanel, 'backgroundColor'), 'rgb(34, 37, 43)');
  assert.equal(await css(list, 'backgroundColor'), 'rgb(34, 37, 43)');
  await setSystemTheme('light');
  assert.equal(await css(select('mobile-dock'), 'backgroundColor'), 'rgb(242, 245, 249)');
  assert.equal(await css(screenPanel, 'backgroundColor'), 'rgb(252, 253, 255)');
  assert.equal(await css(list, 'backgroundColor'), 'rgb(252, 253, 255)');
  assert.equal(await css(list, 'colorScheme'), 'light');
  assert.equal(await css(selectedOption, 'color'), 'rgb(24, 95, 168)');
  assert.equal(await css(selectedOption, 'backgroundColor'), 'rgb(229, 240, 255)');
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
  const switchLabel = () => evaluate(keyboardSwitch + '.textContent.trim()');
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
  await evaluate(`(() => {
    localStorage.removeItem('rd_web_soft_function_keys');
    localStorage.setItem('rd_web_soft_shortcuts', JSON.stringify([
      { key: 'Escape', modifiers: [] },
      { key: 'a', modifiers: ['Control'] },
    ]));
  })()`);
  await tapElement(select('dock-keyboard'));
  await until(`${softbar}?.dataset.keyboardMode === 'system'`);
  assert.equal(await evaluate('document.activeElement === ' + select('soft-input')), true);
  await evaluate(`window.setTestViewportHeight(${fullHeight - 260})`);
  await until(`${select('stage')}.dataset.keyboardAvoiding === 'true'`);
  await setSystemTheme('dark');
  const systemKeyboardTop = await evaluate(toolbarTop);
  const functionRow = select('soft-function-row');
  const operationRow = select('soft-operation-row');
  assert.equal(await evaluate(`${operationRow}.getBoundingClientRect().top - ${functionRow}.getBoundingClientRect().bottom`), 2);
  assert.equal(await css(functionRow, 'backgroundColor'), 'rgba(0, 0, 0, 0)');
  assert.equal(await css(functionRow, 'columnGap'), '4px');
  assert.equal(await css(select('soft-key-strip'), 'columnGap'), '3px');
  await until(`getComputedStyle(${select('soft-mod-ctrl')}).borderColor === 'rgb(64, 69, 76)'`);
  await until(`getComputedStyle(${select('soft-mod-ctrl')}).backgroundColor === 'rgb(48, 53, 60)'`);
  assert.equal(await css(select('soft-shortcut-toggle'), 'backgroundColor'), 'rgb(48, 53, 60)');
  assert.ok(await evaluate(`Math.abs(${operationRow}.getBoundingClientRect().bottom - window.visualViewport.height) < 1`));
  assert.match(await switchLabel(), /切到电脑键盘|Switch to computer keyboard/);
  assert.ok(await evaluate(`${operationRow}.firstElementChild === ${keyboardSwitch} &&
    ${operationRow}.lastElementChild === ${select('soft-hide')}`));

  await tapElement(keyboardSwitch);
  assert.equal(await evaluate(softbar + '.dataset.keyboardMode'), 'virtual');
  assert.match(await switchLabel(), /切到手机键盘|Switch to phone keyboard/);
  assert.equal(await evaluate(select('soft-input') + ' === null'), true);
  assert.equal(await evaluate(toolbarTop), systemKeyboardTop);
  for (const remaining of [310, 180, 90, 0]) {
    await evaluate(`window.setTestViewportHeight(${fullHeight - remaining})`);
    await delay(35);
    assert.equal(await evaluate(toolbarTop), systemKeyboardTop);
  }
  assert.equal(await evaluate(virtualKeyboard + '.getBoundingClientRect().height'), 260);

  assert.deepEqual(await evaluate(`Array.from(${virtualKeyboard}.children, row => row.children.length)`), [10, 9, 9, 3]);
  assert.deepEqual(await evaluate(`Array.from(${virtualKeyboard}.children, row =>
    Array.from(row.querySelectorAll('[data-key-feedback^="letter-"]'), key => key.textContent).join(''))`),
    ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '']);
  assert.ok(await evaluate(`[...(${virtualKeyboard}).querySelectorAll('button')].every(key => {
    const { left, right } = key.getBoundingClientRect();
    return left >= 0 && right <= window.innerWidth;
  })`));

  const keyEvents = "window.sent.filter(event => event.type === 'key')";
  const firstVirtualEvent = await evaluate(keyEvents + '.length');
  const letterA = `${virtualKeyboard}.querySelector('[data-key-feedback="letter-a"]')`;
  const ctrl = select('soft-mod-ctrl');
  async function assertFunctionKeyStyle() {
    for (const property of ['backgroundColor', 'borderColor', 'borderRadius', 'color']) {
      const letterStyle = await css(letterA, property);
      assert.equal(await css(ctrl, property), letterStyle);
      assert.equal(await css(select('soft-shortcut-toggle'), property), letterStyle);
    }
  }
  await assertFunctionKeyStyle();
  await setSystemTheme('light');
  assert.equal(await css(functionRow, 'backgroundColor'), 'rgba(0, 0, 0, 0)');
  assert.equal(await evaluate(`${operationRow}.getBoundingClientRect().top - ${functionRow}.getBoundingClientRect().bottom`), 2);
  await until(`getComputedStyle(${ctrl}).backgroundColor === 'rgb(255, 255, 255)'`);
  await assertFunctionKeyStyle();
  assert.equal(await css(softbar, 'colorScheme'), 'light');
  assert.equal(await css(operationRow, 'backgroundColor'), 'rgb(242, 245, 249)');
  assert.equal(await css(letterA, 'backgroundColor'), 'rgb(255, 255, 255)');
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
  await until(`getComputedStyle(${ctrl}).backgroundColor === 'rgb(229, 240, 255)'`);
  await setSystemTheme('dark');
  await until(`getComputedStyle(${ctrl}).borderColor === 'rgb(64, 69, 76)'`);
  await until(`getComputedStyle(${ctrl}).backgroundColor === 'rgb(48, 72, 99)'`);
  await tapElement(select('soft-mod-shift'));
  await tapElement(`${virtualKeyboard}.querySelector('[data-key="Enter"]')`);
  await tapElement(`${virtualKeyboard}.querySelector('[data-key="Shift"]')`);
  assert.equal(await evaluate(letterA + '.getAttribute("aria-label")'), 'A');
  await tapElement(letterA);
  await tapElement(select('virtual-keyboard-page'));
  assert.equal(await evaluate(virtualKeyboard + '.dataset.keyboardPage'), 'numbers');
  const numberOne = `${virtualKeyboard}.querySelector('[data-key-feedback="symbol-1"]')`;
  await tapElement(numberOne);
  await tapElement(`${virtualKeyboard}.querySelector('[data-key="Shift"]')`);
  assert.equal(await evaluate(numberOne + '.getAttribute("aria-label")'), '!');
  await tapElement(numberOne);
  await tapElement(select('virtual-keyboard-page'));
  assert.equal(await evaluate(virtualKeyboard + '.dataset.keyboardPage'), 'letters');
  await tapElement(`${virtualKeyboard}.querySelector('[data-key="Backspace"]')`);
  const virtualEvents = (await evaluate(keyEvents)).slice(firstVirtualEvent);
  assert.deepEqual(virtualEvents.map(event => [event.action, event.control ?? event.chr]), [
    ['down', 'a'], ['up', 'a'],
    ['down', 'Control'], ['down', 'Shift'], ['down', 'Enter'],
    ['up', 'Enter'], ['up', 'Shift'], ['up', 'Control'],
    ['down', 'A'], ['up', 'A'],
    ['down', '1'], ['up', '1'],
    ['down', '!'], ['up', '!'],
    ['down', 'Backspace'], ['up', 'Backspace'],
  ]);
  assert.equal(await evaluate(select('soft-input') + ' === null'), true);

  const settingsButton = select('soft-shortcut-toggle');
  const shortcutSettings = select('soft-shortcut-settings');
  const shortcutButton = select('soft-shortcut');
  const functionStrip = select('soft-key-strip');
  const functionKey = key => `${functionStrip}.querySelector('[data-function-key="${key}"]')`;
  const shortcutOption = id => `${shortcutSettings}.querySelector('[data-shortcut-option="${id}"]')`;
  const tabOption = shortcutOption(':Tab');
  const escapeOption = shortcutOption(':Escape');
  const savedCombo = shortcutOption('Control:a');
  assert.ok(await evaluate(`${functionRow}.firstElementChild.contains(${settingsButton})`));
  assert.deepEqual(await evaluate(`Array.from(${functionStrip}.querySelectorAll('[data-function-key]'), key => key.dataset.functionKey)`),
    ['Control', 'Alt', 'Shift', 'Meta', 'Escape']);
  assert.equal(await evaluate(`getComputedStyle(${functionStrip}).scrollbarWidth`), 'none');
  assert.equal(await evaluate(shortcutButton + '.textContent'), 'Ctrl+A');
  await tapElement(settingsButton);
  await until(shortcutSettings);
  await setSystemTheme('light');
  assert.equal(await css(shortcutSettings, 'backgroundColor'), 'rgb(252, 253, 255)');
  assert.equal(await css(shortcutSettings, 'color'), 'rgb(24, 35, 53)');
  await until(`getComputedStyle(${settingsButton}).backgroundColor === 'rgb(229, 240, 255)'`);
  assert.equal(await css(tabOption, 'backgroundColor'), 'rgb(242, 245, 249)');
  assert.equal(await css(escapeOption, 'backgroundColor'), 'rgb(229, 240, 255)');
  assert.equal(await css(escapeOption, 'color'), 'rgb(24, 95, 168)');
  await setSystemTheme('dark');
  assert.equal(await css(shortcutSettings, 'backgroundColor'), 'rgb(34, 37, 43)');
  const panelFits = width => `(() => {
    const panel = ${shortcutSettings}.getBoundingClientRect();
    return Math.abs(panel.left - 8) < 1 && Math.abs(panel.right - (${width} - 8)) < 1 &&
      panel.top >= window.visualViewport.offsetTop && panel.bottom <= ${toolbarTop};
  })()`;
  const buttonHeights = `Array.from(
    [${settingsButton}, ...${functionStrip}.querySelectorAll('button'), ...${shortcutSettings}.querySelectorAll('.soft-shortcut-chip')],
    button => button.getBoundingClientRect().height
  )`;
  assert.ok(await evaluate(panelFits(390)));
  assert.deepEqual([...new Set(await evaluate(buttonHeights))], [32]);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 320, height: 740, deviceScaleFactor: 1, mobile: true });
  await until(panelFits(320));
  assert.deepEqual([...new Set(await evaluate(buttonHeights))], [32]);
  await cdp('Emulation.setDeviceMetricsOverride', { width: 390, height: 740, deviceScaleFactor: 1, mobile: true });
  await until(panelFits(390));
  assert.equal(await evaluate(shortcutOption(':a') + ' === null'), true);
  assert.equal(await evaluate(shortcutOption(':1') + ' === null'), true);
  assert.equal(await evaluate(savedCombo + '.getAttribute("aria-pressed")'), 'true');
  assert.equal(await evaluate(`getComputedStyle(${tabOption}.parentElement).flexWrap`), 'wrap');
  assert.ok(await evaluate(`${shortcutOption(':PageDown')}.getBoundingClientRect().width >
    ${tabOption}.getBoundingClientRect().width`));
  await tapElement(escapeOption);
  assert.equal(await evaluate(escapeOption + '.getAttribute("aria-pressed")'), 'false');
  assert.equal(await evaluate(functionKey('Escape') + ' === null'), true);
  await tapElement(tabOption);
  assert.equal(await evaluate(tabOption + '.getAttribute("aria-pressed")'), 'true');
  assert.ok(await evaluate('Boolean(' + functionKey('Tab') + ')'));
  await tapElement(settingsButton);
  const beforeShortcut = await evaluate(keyEvents + '.length');
  await tapElement(shortcutButton);
  assert.deepEqual((await evaluate(keyEvents)).slice(beforeShortcut).map(event => [event.action, event.control ?? event.chr]), [
    ['down', 'Control'], ['down', 'a'], ['up', 'a'], ['up', 'Control'],
  ]);

  await tapElement(keyboardSwitch);
  assert.equal(await evaluate(softbar + '.dataset.keyboardMode'), 'system');
  assert.match(await switchLabel(), /切到电脑键盘|Switch to computer keyboard/);
  assert.equal(await evaluate('document.activeElement === ' + select('soft-input')), true);
  assert.equal(await evaluate(toolbarTop), systemKeyboardTop);
  for (const remaining of [90, 260, 0, 310, 140, 260]) {
    await evaluate(`window.setTestViewportHeight(${fullHeight - remaining})`);
    await delay(35);
    assert.equal(await evaluate(toolbarTop), systemKeyboardTop);
  }
  await delay(200);
  await evaluate(`window.setTestViewportHeight(${fullHeight})`);
  await delay(70);
  assert.equal(await evaluate(toolbarTop), systemKeyboardTop);
  await evaluate(`window.setTestViewportHeight(${fullHeight - 260})`);
  await delay(200);
  assert.equal(await evaluate(toolbarTop), systemKeyboardTop);

  await evaluate(`window.setTestViewportHeight(${fullHeight})`);
  await delay(65);
  assert.equal(await evaluate(toolbarTop), systemKeyboardTop);
  await until(select('mobile-dock-expand'));
  console.log('Keyboard: 26 letters, stable height through viewport jitter and native dismissal verified.');

  await cdp('Emulation.setTouchEmulationEnabled', { enabled: false });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await connect();
  await openDesktopToolbar();
  assert.equal(await evaluate('Boolean(' + select('toolbar-cad') + ')'), true);
  await evaluate(select('toolbar-keyboard') + '.click()');
  await until(select('soft-mod-win'));
  assert.equal(await evaluate(shortcutButton + '.textContent'), 'Ctrl+A');
  await evaluate(settingsButton + '.click()');
  await until(savedCombo);
  assert.equal(await evaluate(functionKey('Escape') + ' === null'), true);
  assert.ok(await evaluate('Boolean(' + functionKey('Tab') + ')'));
  await evaluate(savedCombo + '.click()');
  await evaluate(tabOption + '.click()');
  await evaluate(escapeOption + '.click()');
  assert.equal(await evaluate(shortcutButton + ' === null'), true);
  assert.ok(await evaluate('Boolean(' + functionKey('Escape') + ')'));
  await evaluate(settingsButton + '.click()');
  console.log('Function settings: content-sized choices, one-tap toggles, saved shortcuts and persistence verified.');
  assert.equal(await evaluate(select('soft-mod-win') + '.textContent'), 'Win');
  assert.equal(await evaluate(select('soft-mod-alt') + '.textContent'), 'Alt');
  await evaluate(select('soft-hide') + '.click()');
  await evaluate(select('toolbar-open-menu') + '.click()');
  await until(select('session-backdrop'));
  assert.equal(await evaluate(hasPrivacySwitch), false);
  assert.equal(await evaluate(connectionDetails + ' === null'), true);
  await evaluate(select('menu-tab-display') + '.click()');
  assert.equal(await evaluate(hasPrivacySwitch), true);
  assert.ok(await evaluate('Boolean(' + connectionDetails + ')'));
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
  assert.equal(await evaluate(functionKey('PageDown') + ' === null'), true);
  await evaluate(settingsButton + '.click()');
  await until(shortcutOption(':PageDown'));
  await evaluate(settingsButton + '.click()');
  await evaluate(select('soft-hide') + '.click()');
  const credentialPrefix = 'rd_web_device_password_v1:id:';
  const rememberedPeers = ['901234567', '901234568'];
  const samplePassword = 'example-test-password';
  async function openPeer(peer, requireToken = false) {
    const url = new URL(appUrl);
    url.searchParams.set('peer', peer);
    if (requireToken) url.searchParams.set('requireToken', '1');
    await cdp('Page.navigate', { url: url.href });
    await until(`window.sent && ${select('peer-id')}?.value.replace(/\\s/g, '') === '${peer}'`);
    await evaluate(select('connect') + '.click()');
  }
  for (const peer of rememberedPeers) {
    const storageKey = JSON.stringify(credentialPrefix + peer);
    await evaluate(`localStorage.removeItem(${storageKey})`);
    await openPeer(peer);
    await until(select('password-confirm-connect'));
    await evaluate(select('password') + '.focus()');
    await cdp('Input.insertText', { text: samplePassword });
    await evaluate(select('remember-password') + '.click()');
    await evaluate(select('password-confirm-connect') + '.click()');
    await until(`localStorage.getItem(${storageKey})`);
    const payload = JSON.parse(await evaluate(`localStorage.getItem(${storageKey})`));
    assert.ok(payload.iv && payload.data);
    assert.ok(!JSON.stringify(payload).includes(samplePassword));
  }
  const [firstPeer, secondPeer] = rememberedPeers;
  await evaluate('sessionStorage.clear()');
  await openPeer(firstPeer, true);
  await until("window.sent.some(event => event.type === 'connect')");
  assert.equal(await evaluate("window.sent.find(event => event.type === 'connect').password"), samplePassword);
  await until(select('connect'));
  await evaluate(select('connect') + '.click()');
  await until(select('clear-saved-password'));
  assert.equal(await evaluate(select('password') + '.value'), samplePassword);
  await evaluate(select('clear-saved-password') + '.click()');
  assert.equal(await evaluate(`localStorage.getItem('${credentialPrefix + firstPeer}')`), null);
  assert.ok(await evaluate(`localStorage.getItem('${credentialPrefix + secondPeer}')`));
  await openPeer(firstPeer);
  await until(select('password-confirm-connect'));
  assert.equal(await evaluate(select('password') + '.value'), '');
  await openPeer(secondPeer);
  await until("window.sent.some(event => event.type === 'connect')");
  assert.equal(await evaluate("window.sent.find(event => event.type === 'connect').password"), samplePassword);
  await evaluate(`localStorage.removeItem('${credentialPrefix + secondPeer}')`);
  const legacyPeer = '901234569';
  const legacyKey = 'rd_web_session_credentials_v1';
  await evaluate(`(async () => {
    const key = await new Promise((resolve, reject) => {
      const open = indexedDB.open('rd_web_keys', 1);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const read = db.transaction('keys').objectStore('keys').get('tab-passwords');
        read.onsuccess = () => { db.close(); resolve(read.result); };
        read.onerror = () => { db.close(); reject(read.error); };
      };
    });
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
      new TextEncoder().encode(JSON.stringify({ 'id:${legacyPeer}': '${samplePassword}' })));
    const base64 = bytes => btoa(String.fromCharCode(...bytes));
    sessionStorage.setItem('${legacyKey}', JSON.stringify({ iv: base64(iv), data: base64(new Uint8Array(data)) }));
  })()`);
  assert.ok(await evaluate(`sessionStorage.getItem('${legacyKey}')`));
  await openPeer(legacyPeer);
  await until("window.sent.some(event => event.type === 'connect')");
  assert.equal(await evaluate("window.sent.find(event => event.type === 'connect').password"), samplePassword);
  assert.ok(await evaluate(`localStorage.getItem('${credentialPrefix + legacyPeer}')`));
  assert.equal(await evaluate(`sessionStorage.getItem('${legacyKey}')`), null);
  await evaluate(`localStorage.removeItem('${credentialPrefix + legacyPeer}')`);
  console.log('Remembered passwords: encrypted per device, restored without session storage, migrated, and cleared independently.');

  const gatewayStorageKey = 'rd_web_gateway_token_v1';
  const gatewayUrl = new URL(appUrl);
  gatewayUrl.searchParams.set('tokenTest', '1');
  gatewayUrl.searchParams.set('peer', '901234570');
  const gatewaySettingsInput = select('settings-gateway-token');
  const editGatewayToken = select('settings-gateway-token-edit');
  const saveGatewayToken = select('settings-gateway-token-save');
  async function openNetworkSettings() {
    await until(select('mobile-open-settings'));
    await evaluate(select('mobile-open-settings') + '.click()');
    await until(select('settings-tab-network'));
    await evaluate(select('settings-tab-network') + '.click()');
    await until(editGatewayToken);
  }
  await evaluate(`localStorage.removeItem('${gatewayStorageKey}')`);
  await cdp('Page.navigate', { url: gatewayUrl.href });
  await openNetworkSettings();
  assert.equal(await evaluate(gatewaySettingsInput), null);
  await evaluate(editGatewayToken + '.click()');
  await until(gatewaySettingsInput);
  await evaluate(gatewaySettingsInput + '.focus()');
  await cdp('Input.insertText', { text: 'test-gateway-token' });
  await evaluate(saveGatewayToken + '.click()');
  await until(gatewaySettingsInput + ' === null');
  const encryptedToken = await evaluate(`localStorage.getItem('${gatewayStorageKey}')`);
  assert.ok(JSON.parse(encryptedToken).iv && JSON.parse(encryptedToken).data);
  assert.ok(!encryptedToken.includes('test-gateway-token'));
  await cdp('Page.reload');
  await until(select('connect'));
  await evaluate(select('connect') + '.click()');
  await until(select('password-confirm-connect'));
  assert.equal(await evaluate(select('gateway-token')), null);
  await evaluate(select('password-confirm-connect') + '.click()');
  await until(`${select('stage')}.dataset.remoteActive === 'true'`);
  assert.equal(await evaluate("window.sent.find(event => event.type === 'connect').token"), 'test-gateway-token');

  await cdp('Page.reload');
  await openNetworkSettings();
  assert.equal(await evaluate(gatewaySettingsInput), null);
  await evaluate(editGatewayToken + '.click()');
  assert.equal(await evaluate(gatewaySettingsInput + '.value'), 'test-gateway-token');
  await evaluate(gatewaySettingsInput + '.select()');
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Backspace', code: 'Backspace', windowsVirtualKeyCode: 8 });
  assert.equal(await evaluate(gatewaySettingsInput + '.value'), '');
  await evaluate(saveGatewayToken + '.click()');
  await until(gatewaySettingsInput + ' === null');
  assert.equal(await evaluate(`localStorage.getItem('${gatewayStorageKey}')`), null);
  await cdp('Page.reload');
  await until(select('connect'));
  await evaluate(select('connect') + '.click()');
  await until(select('gateway-token'));
  assert.equal(await evaluate(select('gateway-token') + '.value'), '');
  console.log('Gateway token: hidden by default, encrypted and reused after reload, and prompts again after clearing.');

  const directPriorityUrl = new URL(appUrl);
  directPriorityUrl.searchParams.set('webRtcTest', '1');
  directPriorityUrl.searchParams.set('peer', '901234571');
  async function beginWebRtcTest() {
    await cdp('Page.navigate', { url: directPriorityUrl.href });
    await until(`window.openedConnections && ${select('connect')}`);
    await evaluate(select('connect') + '.click()');
    await until(select('password-confirm-connect'));
    await evaluate(select('password-confirm-connect') + '.click()');
  }
  await beginWebRtcTest();
  await until('window.webRtcOffer');
  assert.deepEqual(await evaluate('window.openedConnections'), ['/ws/webrtc']);
  assert.equal(await evaluate("window.sent.some(event => event.type === 'connect')"), false);
  await evaluate('window.rejectWebRtcOffer()');
  await until(`${select('stage')}.dataset.remoteActive === 'true'`);
  assert.deepEqual(await evaluate('window.openedConnections'), ['/ws/webrtc', '/ws']);
  assert.equal(await evaluate("window.sent.filter(event => event.type === 'connect').length"), 1);

  directPriorityUrl.searchParams.set('forceRelay', '1');
  await beginWebRtcTest();
  await until(`${select('stage')}.dataset.remoteActive === 'true'`);
  assert.deepEqual(await evaluate('window.openedConnections'), ['/ws']);
  assert.equal(await evaluate("window.sent.find(event => event.type === 'connect').forceRelay"), true);
  console.log('WebRTC priority: signal first, open the gateway only after fallback, and preserve forced relay.');
} finally {
  socket.close();
  const closed = await fetch(`${debuggerUrl}/json/close/${tab.id}`);
  assert.ok(closed.ok, 'Chrome must allow closing the test tab');
}
