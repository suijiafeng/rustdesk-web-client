import assert from 'node:assert/strict';
import test from 'node:test';
import { formatConnectionError } from './errors';

test('classifies wrong password into auth error in zh and en', () => {
  const zh = formatConnectionError(
    'zh',
    'The host rejected the password. Check the permanent password and connect again.',
  );
  assert.equal(zh.kind, 'auth');
  assert.equal(zh.title, '密码错误');
  assert.match(zh.message, /密码/);

  const en = formatConnectionError('en', 'wrong password');
  assert.equal(en.kind, 'auth');
  assert.equal(en.title, 'Incorrect Password');
});

test('classifies empty/required password into auth error', () => {
  const res = formatConnectionError(
    'zh',
    'The host requires a password. Enter the permanent password set on the desktop and connect again.',
  );
  assert.equal(res.kind, 'auth');
  assert.equal(res.title, '需要访问密码');
});

test('classifies gateway access token error into auth error', () => {
  const res = formatConnectionError('zh', 'The gateway access token is missing or incorrect.');
  assert.equal(res.kind, 'auth');
  assert.equal(res.title, '网关令牌无效');
});

test('explains unsupported two-factor authentication without suggesting a password change', () => {
  for (const raw of [
    'The host requires two-factor authentication, which this web client does not support yet.',
    'The host requires two-factor authentication, which is not yet enabled on this gateway.',
  ]) {
    assert.equal(formatConnectionError('en', raw).title, 'Two-Factor Authentication Required');
    const zh = formatConnectionError('zh', raw);
    assert.equal(zh.kind, 'generic');
    assert.match(zh.message, /双重验证/);
    assert.doesNotMatch(zh.message, /密码/);
  }
});

test('explains authentication backoff instead of an unexpected session failure', () => {
  const raw = 'Too many failed attempts. Try again shortly. [stage=waiting answer]';
  assert.equal(formatConnectionError('en', raw).title, 'Too Many Attempts');
  assert.match(formatConnectionError('zh', raw).message, /稍后重试/);
});

test('keeps interrupted sessions distinct from gateway startup errors in both locales', () => {
  for (const raw of ['The remote session disconnected unexpectedly.', '远程会话意外断开。']) {
    const en = formatConnectionError('en', raw);
    assert.equal(en.kind, 'network');
    assert.equal(en.title, 'Connection Interrupted');
    assert.match(en.message, /network and retry/);
    const zh = formatConnectionError('zh', raw);
    assert.equal(zh.title, '连接已中断');
    assert.match(zh.message, /检查网络后重试/);
  }
});

test('distinguishes address and port restrictions without calling every target a private network', () => {
  for (const locale of ['zh', 'en'] as const) {
    const address = formatConnectionError(locale, 'That target address is not allowed.');
    const port = formatConnectionError(locale, 'That target port is not allowed.');
    assert.equal(address.kind, 'network');
    assert.equal(port.kind, 'network');
    assert.notEqual(address.message, port.message);
    assert.match(address.message, locale === 'zh' ? /此地址/ : /target address/);
    assert.match(port.message, locale === 'zh' ? /此端口/ : /target port/);
    assert.doesNotMatch(address.message, /private|内网/);
  }
});

test('classifies offline errors with device availability guidance', () => {
  const res = formatConnectionError(
    'zh',
    'The remote desktop is offline, or the ID does not match this host.',
  );
  assert.equal(res.kind, 'network');
  assert.equal(res.title, '设备不在线');
  assert.match(res.message, /开机、联网/);
  assert.doesNotMatch(res.message, /ID 不存在/);
});

test('distinguishes missing IDs from offline devices in both languages', () => {
  for (const raw of ['ID does not exist', 'peer not found']) {
    const zh = formatConnectionError('zh', raw);
    assert.equal(zh.kind, 'network');
    assert.equal(zh.title, '设备 ID 不存在');
    assert.match(zh.message, /相同的 ID 服务器/);
    const en = formatConnectionError('en', raw);
    assert.equal(en.title, 'Device ID Not Found');
    assert.match(en.message, /same ID server/);
  }
  const offline = formatConnectionError('en', 'remote desktop is offline');
  assert.equal(offline.title, 'Device Offline');
  assert.match(offline.message, /powered on/);
  assert.doesNotMatch(offline.message, /does not exist/);
});

test('classifies server key / signature mismatch into network error', () => {
  const res = formatConnectionError('zh', 'Invalid server public key signature');
  assert.equal(res.kind, 'network');
  assert.equal(res.title, '服务器公钥不匹配');
});

test('classifies connection refused / unreachable and DNS failures distinctly', () => {
  const refused = formatConnectionError(
    'zh',
    'Cannot reach the server or host. Check the address, port, and firewall settings.',
  );
  assert.equal(refused.kind, 'network');
  assert.equal(refused.title, '无法连接到目标');

  const dnsEn = formatConnectionError('en', 'getaddrinfo ENOTFOUND hbbs.invalid');
  assert.equal(dnsEn.kind, 'network');
  assert.equal(dnsEn.title, 'DNS Resolution Failed');

  const dnsZh = formatConnectionError(
    'zh',
    'DNS lookup failed for "rs.bad-domain.test". Check the domain spelling, remove any http:// prefix, and verify DNS records.',
  );
  assert.equal(dnsZh.kind, 'network');
  assert.equal(dnsZh.title, '域名解析失败');
  assert.match(dnsZh.message, /rs\.bad-domain\.test/);
});

test('classifies timeout into network error', () => {
  const res = formatConnectionError(
    'zh',
    'The host did not answer in time. It may be offline, or a firewall is blocking the port.',
  );
  assert.equal(res.kind, 'network');
  assert.equal(res.title, '连接超时');
});

test('classifies WebCodecs and insecure context into codec error', () => {
  const insecure = formatConnectionError('zh', 'WebCodecs requires HTTPS or a secure context');
  assert.equal(insecure.kind, 'codec');
  assert.equal(insecure.title, '浏览器解码异常');
  assert.match(insecure.message, /HTTPS/);

  const noCodec = formatConnectionError(
    'zh',
    'This browser cannot decode VP8, VP9, H.264, HEVC, or AV1.',
  );
  assert.equal(noCodec.kind, 'codec');
  assert.match(noCodec.message, /VP8/);
});

test('falls back cleanly for empty or unknown error messages', () => {
  const empty = formatConnectionError('zh', '   ');
  assert.equal(empty.kind, 'generic');
  assert.equal(empty.title, '连接失败');
  assert.ok(empty.message.length > 0);

  const custom = formatConnectionError('en', 'Custom host policy rejected session');
  assert.equal(custom.kind, 'generic');
  assert.equal(custom.message, 'The session ended unexpectedly. Please try again.');
});

test('classifies non-RustDesk HTTP and protobuf wire-type errors cleanly in zh and en', () => {
  const httpZh = formatConnectionError(
    'zh',
    'Not a RustDesk server: received an HTTP response instead of RustDesk protocol data.',
  );
  assert.equal(httpZh.kind, 'network');
  assert.equal(httpZh.title, '不是 RustDesk 服务器');
  assert.match(httpZh.message, /HTTP/);
  assert.doesNotMatch(httpZh.message, /wire type/i);

  const wireZh = formatConnectionError('zh', 'invalid wire type 4 at offset 1');
  assert.equal(wireZh.kind, 'network');
  assert.equal(wireZh.title, '不是 RustDesk 服务器');
  assert.match(wireZh.message, /ID 服务器/);

  const httpEn = formatConnectionError(
    'en',
    'Not a RustDesk server: received an HTTP response instead of RustDesk protocol data.',
  );
  assert.equal(httpEn.kind, 'network');
  assert.equal(httpEn.title, 'Not a RustDesk Server');
  assert.match(httpEn.message, /HTTP/);
});

