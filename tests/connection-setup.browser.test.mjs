// Start Vite and a dedicated headless Chrome, then run:
// APP_URL=http://127.0.0.1:4175/ CDP_URL=http://127.0.0.1:9224 node --test --test-timeout=30000 tests/connection-setup.browser.test.mjs
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const appUrl = process.env.APP_URL || 'http://127.0.0.1:4175/';
const debuggerUrl = process.env.CDP_URL || 'http://127.0.0.1:9224';
const response = await fetch(`${debuggerUrl}/json/new?about:blank`, { method: 'PUT' });
assert.ok(response.ok, 'Chrome must allow creating a test tab');
const tab = await response.json();
const socket = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
const waiting = new Map();
const exceptions = [];
let sequence = 0;
socket.onmessage = ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
  const pending = waiting.get(message.id);
  if (pending) {
    waiting.delete(message.id);
    if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
    else pending.resolve(message.result);
  }
};
const cdp = (method, params = {}) => new Promise((resolve, reject) => {
  waiting.set(++sequence, { resolve, reject });
  socket.send(JSON.stringify({ id: sequence, method, params }));
});
async function evaluate(expression) {
  const result = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function until(expression) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await evaluate(`Boolean(${expression})`)) return;
    await delay(50);
  }
  throw new Error('Timed out: ' + expression);
}
const select = testId => `document.querySelector('[data-testid="${testId}"]')`;
const prefs = "JSON.parse(localStorage.getItem('rd_web_prefs'))";
const requests = 'window.connectionRequests';
const serverDialog = select('id-server-modal');
const passwordDialog = select('password-modal');
async function click(testId) {
  await until(select(testId));
  await evaluate(`${select(testId)}.focus(); ${select(testId)}.click()`);
}
async function fill(testId, value) {
  await evaluate(`(() => {
    const input = ${select(testId)};
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
}
async function key(key, shift = false) {
  await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key, code: key, modifiers: shift ? 8 : 0 });
  await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, modifiers: shift ? 8 : 0 });
}
async function checkFocusTrap(dialog, lastTestId) {
  await until(`${dialog}.contains(document.activeElement)`);
  await evaluate(`${select(lastTestId)}.focus()`);
  await key('Tab');
  assert.equal(await evaluate(`document.activeElement === ${dialog}.querySelector('button')`), true);
  await key('Tab', true);
  assert.equal(await evaluate(`document.activeElement === ${select(lastTestId)}`), true);
  await evaluate(`${select('peer-id')}?.focus()`);
  assert.equal(await evaluate(`${dialog}.contains(document.activeElement)`), true);
}

const mock = `if (location.protocol === 'http:') {
  localStorage.clear();
  localStorage.setItem('rd_web_prefs', JSON.stringify({ peerId: '123456789' }));
}
window.connectionRequests = [];
const browserFetch = window.fetch.bind(window);
window.fetch = (input, options) => input === '/api/health'
  ? Promise.resolve(Response.json({ authRequired: false, webRtcEnabled: false }))
  : browserFetch(input, options);
const BrowserSocket = window.WebSocket;
window.WebSocket = class extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;
  constructor(url, protocols) {
    super();
    if (new URL(url, location.href).pathname !== '/ws') return new BrowserSocket(url, protocols);
    this.readyState = 0;
    setTimeout(() => { this.readyState = 1; this.onopen?.(); }, 0);
  }
  send(value) {
    const message = JSON.parse(value);
    if (message.type !== 'connect') return;
    window.connectionRequests.push(message);
    window.replyConnectionError = detail => this.onmessage?.({
      data: JSON.stringify({ type: 'status', state: 'error', detail }),
    });
  }
  close() { this.readyState = 3; }
};`;

try {
  await cdp('Page.enable');
  await cdp('Runtime.enable');
  await cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
  await cdp('Page.addScriptToEvaluateOnNewDocument', { source: mock });
  await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 850, deviceScaleFactor: 1, mobile: false });
  await cdp('Page.navigate', { url: appUrl });
  await click('connect');
  await until(serverDialog);
  assert.equal(await evaluate(select('settings-sidebar')), null, 'Missing setup must stay in the connection form');
  assert.equal(await evaluate(select('peer-id') + '.value.replace(/\\s/g, "")'), '123456789');
  assert.equal(await evaluate(requests + '.length'), 0);
  assert.equal(await evaluate(select('id-server') + '.getAttribute("aria-invalid")'), null,
    'First-time setup must explain what is needed without marking untouched input invalid');
  assert.equal(await evaluate(serverDialog + '.querySelector("[role=alert]")'), null);
  await evaluate(select('id-server') + '.focus()');
  await until(`document.activeElement === ${select('id-server')}`);
  await evaluate(select('relay-server') + '.focus()');
  await until(select('id-server') + '.getAttribute("aria-invalid") === "true"');
  assert.match(await evaluate(serverDialog + '.querySelector("[role=alert]").textContent'), /ID server|ID 服务器/);
  await checkFocusTrap(serverDialog, 'id-server-save');
  await fill('id-server', 'discarded.example.test:21116');
  await fill('server-key', 'discarded-key');
  await evaluate("document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, isComposing: true }))");
  assert.ok(await evaluate(`Boolean(${serverDialog})`), 'IME Escape must not close the dialog');
  await key('Escape');
  await until(serverDialog + ' === null');
  assert.equal(await evaluate(prefs + '.idServer'), '');
  assert.equal(await evaluate(prefs + '.serverKey'), '');
  assert.equal(await evaluate(`document.activeElement === ${select('connect')}`), true);
  console.log('Missing setup: target stays visible, Tab is trapped, IME is respected, and Escape discards the draft.');

  await click('connect');
  await until(serverDialog);
  assert.equal(await evaluate(select('id-server') + '.value'), '');
  assert.equal(await evaluate(select('id-server') + '.getAttribute("aria-invalid")'), null,
    'Reopening setup must reset the touched state');
  await evaluate(serverDialog + '.requestSubmit()');
  await until(select('id-server') + '.getAttribute("aria-invalid") === "true"');
  assert.equal(await evaluate(`document.activeElement === ${select('id-server')}`), true);
  assert.equal(await evaluate(requests + '.length'), 0);
  await fill('id-server', '  new-id.example.test:21116  ');
  await until(select('id-server') + '.getAttribute("aria-invalid") === null');
  await fill('relay-server', 'new-relay.example.test:21117');
  await fill('server-key', 'not-a-public-key');
  await click('id-server-save');
  assert.ok(await evaluate(`Boolean(${serverDialog})`));
  assert.equal(await evaluate(select('server-key') + '.getAttribute("aria-invalid")'), 'true');
  assert.equal(await evaluate(`document.activeElement === ${select('server-key')}`), true);
  assert.equal(await evaluate(prefs + '.idServer'), '');
  assert.equal(await evaluate(requests + '.length'), 0);
  const publicKey = Buffer.alloc(32, 1).toString('base64');
  await fill('server-key', publicKey);
  await click('id-server-save');
  await until(passwordDialog);
  assert.equal(await evaluate(serverDialog), null);
  assert.equal(await evaluate(select('settings-sidebar')), null);
  assert.match(await evaluate(passwordDialog + '.textContent.replace(/\\s/g, "")'), /123456789/);
  await until(`${prefs}.idServer === 'new-id.example.test:21116'`);
  await checkFocusTrap(passwordDialog, 'password-confirm-connect');
  await key('Escape');
  await until(passwordDialog + ' === null');
  assert.equal(await evaluate(requests + '.length'), 0);
  await click('connect');
  await until(passwordDialog);
  await fill('password', 'first-test-password');
  await click('password-confirm-connect');
  await until(requests + '.length === 1');
  const first = await evaluate(requests + '[0]');
  assert.deepEqual([first.peerId, first.idServer, first.relayServer, first.key],
    ['123456789', 'new-id.example.test:21116', 'new-relay.example.test:21117', publicKey]);
  console.log('Validated setup: malformed keys cannot save; saving valid settings opens the password prompt and sends the new target/server/key.');

  await evaluate("window.replyConnectionError('Wrong Password')");
  await until(select('error-action-password'));
  await fill('peer-id', '987654321');
  await click('error-action-password');
  await until(passwordDialog);
  assert.match(await evaluate(passwordDialog + '.textContent.replace(/\\s/g, "")'), /987654321/);
  await fill('password', 'second-test-password');
  await click('password-confirm-connect');
  await until(requests + '.length === 2');
  assert.equal(await evaluate(requests + '[1].peerId'), '987654321');
  assert.equal(await evaluate(requests + '[1].password'), 'second-test-password');
  await evaluate("window.replyConnectionError('ID does not exist')");
  await until(select('error-action-retry'));
  await fill('peer-id', '456789123');
  await click('error-action-retry');
  await until(passwordDialog);
  await click('password-confirm-connect');
  await until(requests + '.length === 3');
  assert.equal(await evaluate(requests + '[2].peerId'), '456789123');
  console.log('Retry: both password errors and missing-ID errors use the edited target rather than a previous request.');

  const rawDiagnostic = 'Host diagnostic: instance-42 failed at <internal-step>';
  await evaluate(`window.replyConnectionError(${JSON.stringify(rawDiagnostic)})`);
  await until(select('error-info-toggle'));
  assert.ok(!(await evaluate(select('detail') + '.textContent')).includes(rawDiagnostic));
  assert.equal(await evaluate(select('error-technical-details')), null);
  await evaluate(select('error-info-toggle') + '.click()');
  await until(select('error-technical-details'));
  assert.ok((await evaluate(select('error-technical-details') + '.textContent')).includes(rawDiagnostic));
  console.log('Unknown host errors: localized guidance is primary and raw details remain collapsed until expanded.');
  await click('mobile-open-settings');
  await click('settings-tab-general');
  assert.equal(await evaluate(select('settings-toggle-diagnostics')), null,
    'Connection details should not have a duplicate switch in General settings');
  await click('settings-tab-display');
  assert.ok(await evaluate(`Boolean(${select('settings-opt-quality-monitor')})`),
    'Display settings must retain the connection-details switch');
  await click('settings-tab-network');
  await click('open-id-server-dialog');
  await until(serverDialog);
  await fill('id-server', 'ordinary-settings.example.test:21116');
  await fill('server-key', '');
  await click('id-server-save');
  await until(serverDialog + ' === null');
  await until(`${prefs}.idServer === 'ordinary-settings.example.test:21116'`);
  assert.equal(await evaluate(prefs + '.serverKey'), '');
  assert.equal(await evaluate(passwordDialog), null);
  assert.equal(await evaluate(requests + '.length'), 3, 'Saving ordinary settings must not start a connection');
  await click('open-id-server-dialog');
  await fill('id-server', 'cancelled-edit.example.test');
  await key('Escape');
  await until(serverDialog + ' === null');
  assert.equal(await evaluate(prefs + '.idServer'), 'ordinary-settings.example.test:21116');
  assert.equal(await evaluate(`document.activeElement === ${select('open-id-server-dialog')}`), true);
  assert.deepEqual(exceptions, [], JSON.stringify(exceptions));
  console.log('Ordinary settings: optional empty key saves without connecting, while Escape cancels later edits and restores focus.');
} finally {
  socket.close();
  const closed = await fetch(`${debuggerUrl}/json/close/${tab.id}`);
  assert.ok(closed.ok, 'Chrome must allow closing the test tab');
}
