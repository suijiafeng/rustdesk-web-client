// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { GATEWAY_SERVICE, HEALTH_PATH, type HealthResponse } from '@rustdesk-web/shared';
import { createApp } from './index.ts';

test('GET /api/health reports the gateway is up', async () => {
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', () => resolve());
    server.once('error', reject);
  });
  try {
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('gateway test server has no TCP port');
    }
    const response = await fetch(`http://127.0.0.1:${address.port}${HEALTH_PATH}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('x-powered-by'), null);
    const body = (await response.json()) as HealthResponse;
    assert.deepEqual(body, { ok: true, service: GATEWAY_SERVICE, authRequired: false });
    for (let i = 0; i < 20; i += 1) {
      const again = await fetch(`http://127.0.0.1:${address.port}${HEALTH_PATH}`);
      assert.equal(again.status, 200);
      const repeated = (await again.json()) as HealthResponse;
      assert.equal(repeated.ok, true);
    }
  } finally {
    if (!server.listening) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});


test('health advertises WebRTC only when the gateway enables it', async () => {
  const server = createApp('test-token', true).listen(0, '127.0.0.1');
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    assert.ok(address && typeof address !== 'string');
    const response = await fetch(`http://127.0.0.1:${address.port}${HEALTH_PATH}`);
    assert.deepEqual(await response.json(), {
      ok: true, service: GATEWAY_SERVICE, authRequired: true, webRtcEnabled: true,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
