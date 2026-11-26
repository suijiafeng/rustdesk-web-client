import assert from 'node:assert/strict';
import test from 'node:test';
import { GatewayAdmissionLimiter } from './admission.ts';
import { createClientAddressResolver, createRequestProtocolResolver } from './clientAddress.ts';
import { originAllowed } from './security.ts';

test('forwarded protocol cannot change the origin scheme without a trusted TCP peer', () => {
  const headers = { 'x-forwarded-proto': 'https' };
  const resolve = createRequestProtocolResolver({ RUSTDESK_TRUSTED_PROXIES: '127.0.0.1' });
  assert.equal(createRequestProtocolResolver({})('127.0.0.1', headers), 'http:');
  assert.equal(resolve('192.0.2.1', headers), 'http:');
  assert.equal(resolve('192.0.2.1', { 'x-forwarded-proto': 'http' }, true), 'https:');
  assert.equal(resolve(undefined, headers), 'http:');
  assert.equal(resolve('127.0.0.1', {}, true), 'https:');
  assert.equal(originAllowed('https://desk.example', 'desk.example', '', true, {
    protocol: resolve('192.0.2.1', headers),
  }), false);
});

test('trusted proxy protocol preserves external HTTPS and rejects ambiguous header chains', () => {
  const resolve = createRequestProtocolResolver({ RUSTDESK_TRUSTED_PROXIES: '127.0.0.1,2001:db8::/32' });
  assert.equal(resolve('::ffff:127.0.0.1', { 'x-forwarded-proto': ' HTTPS ' }), 'https:');
  assert.equal(resolve('2001:db8::1', { 'x-forwarded-proto': 'http' }), 'http:');
  assert.equal(originAllowed('https://desk.example', 'DESK.EXAMPLE:443', '', true, {
    protocol: resolve('127.0.0.1', { 'x-forwarded-proto': 'https' }),
  }), true);
  for (const forwarded of ['', 'wss', 'https:', 'https, http', 'http, https', ['https', 'https']]) {
    assert.equal(resolve('127.0.0.1', { 'x-forwarded-proto': forwarded }), null);
  }
  assert.throws(() => createRequestProtocolResolver({ RUSTDESK_TRUSTED_PROXIES: '*' }), /RUSTDESK_TRUSTED_PROXIES/);
});

test('forwarded headers are ignored by default and for untrusted TCP peers', () => {
  const headers = { 'x-forwarded-for': '198.51.100.7', 'cf-connecting-ip': '198.51.100.8' };
  assert.equal(createClientAddressResolver({})('::ffff:192.0.2.1', headers), '192.0.2.1');
  const resolve = createClientAddressResolver({ RUSTDESK_TRUSTED_PROXIES: '127.0.0.1,::1' });
  assert.equal(resolve('192.0.2.1', headers), '192.0.2.1');
  assert.equal(resolve('127.0.0.1', {}), '127.0.0.1');
});

test('X-Forwarded-For stops at the nearest untrusted hop and ignores spoofed prefixes', () => {
  const resolve = createClientAddressResolver({ RUSTDESK_TRUSTED_PROXIES: '127.0.0.1,10.1.0.0/16,2001:db8:1::/48' });
  assert.equal(resolve('::ffff:127.0.0.1', {
    'x-forwarded-for': 'garbage, 198.51.100.9, 192.0.2.7, 10.1.2.3, 2001:db8:1::5',
  }), '192.0.2.7');
  assert.equal(resolve('127.0.0.1', { 'x-forwarded-for': '198.51.100.9, 10.2.0.1' }), '10.2.0.1');
  assert.equal(resolve('127.0.0.1', { 'x-forwarded-for': '10.1.2.3' }), '127.0.0.1');
});

test('equivalent IPv4 and IPv6 representations share a normalized address', () => {
  const resolve = createClientAddressResolver({ RUSTDESK_TRUSTED_PROXIES: '::ffff:127.0.0.1,::ffff:10.0.0.0/104' });
  for (const address of ['192.0.2.1', '::ffff:192.0.2.1', '0:0:0:0:0:ffff:c000:201']) {
    assert.equal(resolve(address, {}), '192.0.2.1');
    assert.equal(resolve('127.0.0.1', { 'x-forwarded-for': `${address}, ::ffff:10.1.2.3` }), '192.0.2.1');
  }
  assert.equal(resolve('2001:0DB8:0:0:0:0:0:1', {}), '2001:db8::1');
});

test('malformed or ambiguous forwarded hops fall back to the TCP peer', () => {
  const resolve = createClientAddressResolver({ RUSTDESK_TRUSTED_PROXIES: '127.0.0.1' });
  for (const hop of ['', 'unknown', '192.0.2.1:1234', '[2001:db8::1]', 'fe80::1%eth0', '127.000.0.1', ',']) {
    assert.equal(resolve('127.0.0.1', { 'x-forwarded-for': `198.51.100.7, ${hop}` }), '127.0.0.1');
  }
  assert.equal(resolve('127.0.0.1', { 'x-forwarded-for': ['192.0.2.1', '192.0.2.2'] }), '127.0.0.1');
});

test('Cloudflare header requires both an explicit header policy and a trusted immediate peer', () => {
  const headers = { 'x-forwarded-for': '192.0.2.1', 'cf-connecting-ip': '::ffff:198.51.100.1' };
  assert.equal(createClientAddressResolver({ RUSTDESK_TRUSTED_PROXIES: '127.0.0.1' })('127.0.0.1', headers), '192.0.2.1');
  const resolve = createClientAddressResolver({
    RUSTDESK_TRUSTED_PROXIES: '127.0.0.1', RUSTDESK_CLIENT_IP_HEADER: 'cf-connecting-ip',
  });
  assert.equal(resolve('127.0.0.1', headers), '198.51.100.1');
  assert.equal(resolve('192.0.2.2', headers), '192.0.2.2');
  assert.equal(resolve('127.0.0.1', { 'cf-connecting-ip': '192.0.2.1, 192.0.2.2' }), '127.0.0.1');
  assert.equal(resolve('127.0.0.1', { 'x-forwarded-for': '192.0.2.1' }), '127.0.0.1');
});

test('invalid proxy configuration is rejected at startup', () => {
  for (const value of ['localhost', '*', '192.0.2.0/33', '2001:db8::/129', '10.0.0.0/-1', '10.0.0.0/', '10.0.0.0/8/9', '::ffff:10.0.0.0/80']) {
    assert.throws(() => createClientAddressResolver({ RUSTDESK_TRUSTED_PROXIES: value }), /RUSTDESK_TRUSTED_PROXIES/);
  }
  assert.throws(() => createClientAddressResolver({ RUSTDESK_CLIENT_IP_HEADER: 'forwarded' }), /RUSTDESK_CLIENT_IP_HEADER/);
});

test('proxy clients have independent concurrency and token backoff budgets', () => {
  const resolve = createClientAddressResolver({ RUSTDESK_TRUSTED_PROXIES: '127.0.0.1' });
  const limiter = new GatewayAdmissionLimiter();
  const key = (ip: string) => resolve('::ffff:127.0.0.1', { 'x-forwarded-for': ip });
  const first = limiter.acquire(key('192.0.2.1'));
  assert.ok(first);
  for (let i = 0; i < 3; i++) assert.ok(limiter.acquire(key('::ffff:192.0.2.1')));
  assert.equal(limiter.acquire(key('192.0.2.1')), null);
  const second = limiter.acquire(key('192.0.2.2'));
  assert.ok(second);
  for (let i = 0; i < 3; i++) first.recordTokenFailure();
  assert.equal(first.canAuthenticate(), false);
  assert.equal(second.canAuthenticate(), true);
  assert.ok(limiter.acquire(key('192.0.2.3')));
});
