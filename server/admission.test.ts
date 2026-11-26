import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayAdmissionLimiter } from './admission.ts';

test('admission enforces per-IP and global concurrency and releases slots exactly once', () => {
  const limiter = new GatewayAdmissionLimiter();
  const first = limiter.acquire('first');
  assert.ok(first);
  for (let i = 0; i < 3; i++) assert.ok(limiter.acquire('first'));
  assert.equal(limiter.acquire('first'), null);
  for (let i = 0; i < 124; i++) assert.ok(limiter.acquire(`other-${i}`));
  assert.equal(limiter.acquire('last'), null);
  first.release();
  first.release();
  assert.ok(limiter.acquire('last'));
  assert.equal(limiter.acquire('first'), null);
});

test('admission limits upgrades even after their sockets close', () => {
  let now = 0;
  const limiter = new GatewayAdmissionLimiter(() => now);
  for (let i = 0; i < 24; i++) {
    const entry = limiter.acquire('first');
    assert.ok(entry);
    entry.release();
  }
  assert.equal(limiter.acquire('first'), null);
  assert.ok(limiter.acquire('other'));
  now += 60_000;
  assert.ok(limiter.acquire('first'));
});

test('token failure backoff also covers already admitted sockets', () => {
  let now = 0;
  const limiter = new GatewayAdmissionLimiter(() => now);
  const first = limiter.acquire('first');
  const pending = limiter.acquire('first');
  assert.ok(first && pending);
  for (let i = 0; i < 3; i++) first.recordTokenFailure();
  assert.equal(pending.canAuthenticate(), false);
  assert.equal(limiter.acquire('first'), null);
  now += 1_000;
  assert.equal(pending.canAuthenticate(), true);
  pending.recordTokenFailure();
  now += 1_000;
  assert.equal(pending.canAuthenticate(), false);
  now += 1_000;
  assert.equal(pending.canAuthenticate(), true);
});
