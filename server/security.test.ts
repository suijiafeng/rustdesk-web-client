// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import test from 'node:test';
import dns from 'node:dns/promises';
import { EncryptedFramedStream } from './bytesCodec.ts';
import { originAllowed, productionTokenProblem, redactLog, targetAddressAllowed, targetHostAllowed, targetPortAllowed } from './security.ts';

test('browser origins match the full normalized request origin', () => {
  assert.equal(originAllowed('', '127.0.0.1:3001', ''), true);
  assert.equal(originAllowed('', '127.0.0.1:3001', '', true), false);
  assert.equal(originAllowed('http://desk.example:3000', 'DESK.EXAMPLE:3000', ''), true);
  assert.equal(originAllowed('http://desk.example:80', 'DESK.EXAMPLE', ''), true);
  assert.equal(originAllowed('https://desk.example:443', 'DESK.EXAMPLE', '', true, { protocol: 'https:' }), true);
  assert.equal(originAllowed('https://desk.example', 'desk.example', ''), false);
  assert.equal(originAllowed('http://desk.example', 'desk.example', '', true, { protocol: 'https:' }), false);
  assert.equal(originAllowed('http://desk.example:3001', 'desk.example:3000', ''), false);
  assert.equal(originAllowed('https://desk.example:444', 'desk.example:443', '', true, { protocol: 'https:' }), false);
  assert.equal(originAllowed('http://[2001:db8::1]:3000', '[2001:DB8::1]:3000', ''), true);
  assert.equal(originAllowed('http://[2001:db8::1]:3001', '[2001:db8::1]:3000', ''), false);
  assert.equal(originAllowed('https://evil.example', 'desk.example', ''), false);
});

test('loopback aliases and differing ports require an explicit development exemption', () => {
  const dev = { protocol: 'http:', allowLoopback: true } as const;
  assert.equal(originAllowed('http://127.0.0.1:5173', 'localhost:3001', ''), false);
  assert.equal(originAllowed('http://localhost:5173', 'localhost:3001', ''), false);
  assert.equal(originAllowed('http://127.0.0.1:5173', 'LOCALHOST:3001', '', false, dev), true);
  assert.equal(originAllowed('http://[::1]:5173', '[::1]:3001', '', false, dev), true);
  assert.equal(originAllowed('https://localhost:5173', 'localhost:3001', '', false, dev), false);
  assert.equal(originAllowed('http://desk.example:5173', 'localhost:3001', '', false, dev), false);
});

test('explicit origin allowlists normalize scheme, host and default ports', () => {
  assert.equal(originAllowed('https://evil.example', 'desk.example', 'https://evil.example'), true);
  assert.equal(originAllowed('https://desk.example', 'internal:3000', 'HTTPS://DESK.EXAMPLE:443'), true);
  assert.equal(originAllowed('https://desk.example:444', 'internal:3000', 'https://desk.example'), false);
  assert.equal(originAllowed('http://desk.example', 'internal:3000', 'https://desk.example'), false);
  assert.equal(originAllowed('https://desk.example', 'internal:3000', 'https://other.example'), false);
  assert.equal(originAllowed('https://desk.example', 'internal:3000', '*'), true);
  assert.equal(originAllowed('', 'internal:3000', '*', true), false);
});

test('malformed origins and request authorities cannot bypass origin checks', () => {
  for (const origin of ['null', 'not a url', 'file://desk.example', 'ftp://desk.example',
    'https://user@desk.example', 'https://desk.example/path', 'https://desk.example?x=1',
    'https://desk.example#x', 'https://desk.example https://other.example', 'https:\\desk.example']) {
    assert.equal(originAllowed(origin, 'desk.example', ''), false, origin);
    assert.equal(originAllowed(origin, 'desk.example', '*'), false, origin);
  }
  for (const host of ['', 'desk.example/path', 'user@desk.example', 'desk.example#x', 'desk.example?x=1',
    'desk.example:65536', 'desk.example other.example']) {
    assert.equal(originAllowed('http://desk.example', host, ''), false, host);
  }
  assert.equal(originAllowed('http://desk.example', 'desk.example', '', true, { protocol: null }), false);
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
  const env = { production: true, allowedTargetPorts: [32116, 32117] };
  assert.equal(targetPortAllowed(21116, false, env), true);
  assert.equal(targetPortAllowed(32117, false, env), true);
  assert.equal(targetPortAllowed(8080, false, env), false);
  assert.equal(targetPortAllowed(8080, true, env), true);
  assert.equal(targetPortAllowed(49152, false, env), false);
  assert.equal(targetPortAllowed(49152, true, env), true);
  assert.equal(targetPortAllowed(65536, true, env), false);
});
