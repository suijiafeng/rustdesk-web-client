// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import dns from 'node:dns/promises';
import { EncryptedFramedStream } from './bytesCodec.ts';
import { originAllowed, privateTargetsAllowed, productionTokenProblem, redactLog, targetAddressAllowed, targetHostAllowed, targetPortAllowed } from './security.ts';

test('browser origins are rejected unless they match the host, loopback, or the allowlist', () => {
  assert.equal(originAllowed('', '127.0.0.1:3001', ''), true);
  assert.equal(originAllowed('', '127.0.0.1:3001', '', true), false);
  assert.equal(originAllowed('http://127.0.0.1:5173', 'localhost:3001', ''), true);
  assert.equal(originAllowed('https://desk.example', 'desk.example', ''), true);
  assert.equal(originAllowed('http://[::1]:5173', '[::1]:3001', ''), true);
  assert.equal(originAllowed('https://evil.example', 'desk.example', ''), false);
  assert.equal(originAllowed('https://evil.example', 'desk.example', 'https://evil.example'), true);
  assert.equal(originAllowed('not a url', 'desk.example', ''), false);
});

test('production refuses to start without a real gateway token', () => {
  assert.equal(productionTokenProblem('production', ''), 'Set RUSTDESK_GATEWAY_TOKEN before starting the gateway in production.');
  assert.equal(productionTokenProblem('production', 'real-token'), null);
  assert.equal(productionTokenProblem('development', ''), null);
});

test('log lines do not keep tokens or passwords', () => {
  assert.equal(redactLog('rejected token=abc password: hunter2'), 'rejected token=[redacted] password: [redacted]');
});

test('the gateway will not dial a cloud metadata address', () => {
  assert.equal(targetHostAllowed('192.168.1.20'), true);
  assert.equal(targetHostAllowed('id.example.com'), true);
  assert.equal(targetHostAllowed('metadata.google.internal.'), false);
  assert.equal(targetHostAllowed('user:pass@host'), false);
  assert.equal(targetHostAllowed(''), false);
});

test('address policy applies to both IP families and mapped IPv4 addresses', () => {
  for (const address of ['169.254.1.1', 'fe80::1', '::ffff:169.254.1.1', 'fd00:ec2::254', '168.63.129.16']) {
    assert.equal(targetAddressAllowed(address, true), false, address);
  }
  for (const address of ['127.0.0.1', '192.168.1.20', '100.64.0.1', '::1', 'fd00::1', '::ffff:c0a8:114']) {
    assert.equal(targetAddressAllowed(address, false), false, address);
    assert.equal(targetAddressAllowed(address, true), true, address);
  }
  for (const address of ['8.8.8.8', '::ffff:8.8.8.8', '2606:4700::1111']) {
    assert.equal(targetAddressAllowed(address, false), true, address);
  }
  assert.equal(privateTargetsAllowed({ NODE_ENV: 'production' }), false);
  assert.equal(privateTargetsAllowed({ NODE_ENV: 'production', RUSTDESK_ALLOW_PRIVATE_TARGETS: 'true' }), true);
});

test('the TCP dialer rejects a hostname that resolves only to blocked addresses', async (t) => {
  const lookup = t.mock.method(dns, 'lookup', async () => [
    { address: '169.254.1.10', family: 4 },
    { address: 'fe80::10', family: 6 },
  ]);
  await assert.rejects(EncryptedFramedStream.connect('test.example', 21116, 1_000), /target address is not allowed/);
  assert.equal(lookup.mock.callCount(), 1);
});

test('production restricts server ports and permits dynamic peer ports', () => {
  const env = { NODE_ENV: 'production', RUSTDESK_ALLOWED_TARGET_PORTS: '32116, 32117' };
  assert.equal(targetPortAllowed(21116, false, env), true);
  assert.equal(targetPortAllowed(32117, false, env), true);
  assert.equal(targetPortAllowed(8080, false, env), false);
  assert.equal(targetPortAllowed(8080, true, env), true);
  assert.equal(targetPortAllowed(49152, false, env), false);
  assert.equal(targetPortAllowed(49152, true, env), true);
  assert.equal(targetPortAllowed(65536, true, env), false);
});
