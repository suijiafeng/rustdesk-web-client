// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import { originAllowed, productionTokenProblem, targetHostAllowed } from './security.ts';

test('browser origins are rejected unless they match the host, loopback, or the allowlist', () => {
  assert.equal(originAllowed('', '127.0.0.1:3001', ''), true);
  assert.equal(originAllowed('http://127.0.0.1:5173', 'localhost:3001', ''), true);
  assert.equal(originAllowed('https://desk.example', 'desk.example', ''), true);
  assert.equal(originAllowed('https://evil.example', 'desk.example', ''), false);
  assert.equal(originAllowed('https://evil.example', 'desk.example', 'https://evil.example'), true);
  assert.equal(originAllowed('not a url', 'desk.example', ''), false);
});

test('production refuses to start without a real gateway token', () => {
  assert.equal(productionTokenProblem('production', ''), 'Set RUSTDESK_GATEWAY_TOKEN before starting the gateway in production.');
  assert.equal(productionTokenProblem('production', 'real-token'), null);
  assert.equal(productionTokenProblem('development', ''), null);
});

test('the gateway will not dial a cloud metadata address', () => {
  assert.equal(targetHostAllowed('192.168.1.20'), true);
  assert.equal(targetHostAllowed('id.example.com'), true);
  assert.equal(targetHostAllowed('169.254.169.254'), false);
  assert.equal(targetHostAllowed('metadata.google.internal'), false);
  assert.equal(targetHostAllowed('user:pass@host'), false);
  assert.equal(targetHostAllowed(''), false);
});
