// Builds the real browser protocol path and checks it under script-src 'self'.
// Run: node --test --test-timeout=60000 tests/webrtc-csp.browser.test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const chromePath = process.env.CHROME_BIN || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');

test('WebRTC verifies identity and completes login under the production script policy', async () => {
  const built = await build({
    configFile: path.join(root, 'vite.config.ts'),
    logLevel: 'error',
    build: { write: false, rollupOptions: { input: path.join(root, 'tests/fixtures/webrtcCsp.ts') } },
  });
  const output = (Array.isArray(built) ? built[0] : built).output;
  const entry = output.find(item => item.type === 'chunk' && item.isEntry);
  assert.ok(entry, 'Vite must produce the browser fixture');
  const files = new Map(output.map(item => ['/' + item.fileName, item.type === 'chunk' ? item.code : item.source]));
  const server = http.createServer((request, response) => {
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'");
    const resource = files.get(request.url);
    response.setHeader('Content-Type', resource ? 'text/javascript' : 'text/html');
    response.end(resource ?? `<!doctype html><script type="module" src="/${entry.fileName}"></script>`);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const profile = await mkdtemp(path.join(os.tmpdir(), 'rustdesk-csp-'));
  const chrome = spawn(chromePath, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let launchError;
  chrome.on('error', error => { launchError = error; });
  let socket;
  try {
    let debuggerPort;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (launchError) throw launchError;
      try { debuggerPort = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
      catch { await delay(100); }
    }
    assert.ok(debuggerPort, 'Chrome must start its debugging endpoint');
    const response = await fetch(`http://127.0.0.1:${debuggerPort}/json/new?about:blank`, { method: 'PUT' });
    assert.ok(response.ok);
    const tab = await response.json();
    socket = new WebSocket(tab.webSocketDebuggerUrl);
    await once(socket, 'open');
    const requests = new Map();
    const exceptions = [];
    let sequence = 0;
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
      const pending = requests.get(message.id);
      if (pending) {
        requests.delete(message.id);
        if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
        else pending.resolve(message.result);
      }
    };
    const cdp = (method, params = {}) => new Promise((resolve, reject) => {
      requests.set(++sequence, { resolve, reject });
      socket.send(JSON.stringify({ id: sequence, method, params }));
    });
    await cdp('Runtime.enable');
    await cdp('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
    let result;
    for (let attempt = 0; attempt < 150; attempt++) {
      // Evaluation only observes results. All application code runs from an external module under CSP.
      const state = await cdp('Runtime.evaluate', { expression: 'window.cspResult', returnByValue: true });
      result = state.result.value;
      if (result && result.status !== 'running') break;
      if (exceptions.length) break;
      await delay(100);
    }
    assert.deepEqual(exceptions, [], JSON.stringify(exceptions));
    assert.equal(result?.status, 'passed', JSON.stringify(result));
    assert.equal(result.verified, true);
    assert.equal(result.loggedIn, true);
    assert.deepEqual(result.violations.filter(event => event.blockedURI !== 'wasm-eval'), []);
  } finally {
    socket?.close();
    if (chrome.exitCode === null && chrome.pid) {
      const exited = once(chrome, 'exit');
      chrome.kill('SIGTERM');
      await exited;
    }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(profile, { recursive: true, force: true });
  }
});
