import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer } from 'vite';

const chromePath = process.env.CHROME_BIN || (process.platform === 'darwin'
  ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome');
const profile = await mkdtemp(path.join(os.tmpdir(), 'rd-browser-ci-'));
const sharedBrowserTests = ['session-toolbar.browser.test.mjs', 'connection-setup.browser.test.mjs'];
let vite;
let chrome;

async function run(file, environment = {}) {
  const child = spawn(process.execPath, ['--test', '--test-timeout=60000', `tests/${file}`], {
    stdio: 'inherit', env: { ...process.env, CHROME_BIN: chromePath, ...environment },
  });
  const [code] = await once(child, 'exit');
  if (code !== 0) throw new Error(`${file} failed with exit code ${code}`);
}

async function stopSharedBrowser() {
  await vite?.close();
  vite = undefined;
  if (chrome?.pid && chrome.exitCode === null) {
    const exited = once(chrome, 'exit');
    chrome.kill('SIGTERM');
    const deadline = setTimeout(() => chrome.kill('SIGKILL'), 5_000);
    try { await exited; } finally { clearTimeout(deadline); }
  }
}

try {
  vite = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: true, hmr: false }, logLevel: 'error' });
  await vite.listen();
  chrome = spawn(chromePath, ['--headless', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    ...(process.env.CI ? ['--no-sandbox'] : []), '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  let launchError;
  chrome.on('error', error => { launchError = error; });
  let port;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (launchError) throw launchError;
    try { port = (await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]; break; }
    catch { await delay(100); }
  }
  if (!port) throw new Error('Chrome did not start; set CHROME_BIN to a supported Chrome executable.');
  const environment = { APP_URL: `http://127.0.0.1:${vite.httpServer.address().port}/`, CDP_URL: `http://127.0.0.1:${port}` };
  for (const file of sharedBrowserTests) await run(file, environment);
  await stopSharedBrowser();
  // Each remaining fixture owns its own ephemeral server/profile. Run serially
  // so constrained CI runners never launch several Chromium processes at once.
  for (const file of (await readdir('tests')).filter(file => file.endsWith('.browser.test.mjs') && !sharedBrowserTests.includes(file)).sort()) {
    await run(file);
  }
} finally {
  await stopSharedBrowser();
  await rm(profile, { recursive: true, force: true });
}
