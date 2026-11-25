// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { attachWebRoot, createApp } from './index.ts';

test('the gateway serves the built client and still answers health', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'rd-web-'));
  await writeFile(path.join(root, 'index.html'), '<!doctype html><title>client</title>');
  await writeFile(path.join(root, '.env'), 'TOKEN=secret');
  const app = createApp('');
  attachWebRoot(app, root);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') throw new Error('no port');
    const base = `http://127.0.0.1:${address.port}`;
    const page = await fetch(`${base}/session`);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /client/);
    const health = await fetch(`${base}/api/health`);
    assert.equal(health.status, 200);
    const hidden = await fetch(`${base}/.env`);
    assert.notEqual(hidden.status, 200);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
    await rm(root, { recursive: true, force: true });
  }
});
