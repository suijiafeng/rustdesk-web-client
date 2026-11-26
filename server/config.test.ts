import assert from 'node:assert/strict';
import test from 'node:test';
import { getRuntimeConfig, parseRuntimeConfig, setRuntimeConfig } from './config.ts';
import { originAllowed, targetPortAllowed } from './security.ts';

const production = { NODE_ENV: 'production', RUSTDESK_GATEWAY_TOKEN: 'config-test-token' };

test('configuration applies explicit defaults and preserves production target restrictions', () => {
  const development = parseRuntimeConfig({});
  assert.equal(development.host, '127.0.0.1');
  assert.equal(development.port, 3000);
  assert.equal(development.webRtcEnabled, false);
  assert.equal(development.requireOrigin, false);
  assert.equal(development.defaultForceRelay, false);
  assert.equal(development.allowPrivateTargets, true);
  const config = parseRuntimeConfig({ ...production, RUSTDESK_ALLOWED_TARGET_PORTS: '32116, 32117,32116' });
  assert.equal(config.production, true);
  assert.equal(config.allowPrivateTargets, false);
  assert.deepEqual(config.allowedTargetPorts, [32116, 32117]);
  assert.equal(targetPortAllowed(32116, false, config), true);
  assert.equal(targetPortAllowed(8080, false, config), false);
  assert.equal(parseRuntimeConfig({ ...production, RUSTDESK_ALLOW_PRIVATE_TARGETS: ' true ' }).allowPrivateTargets, true);
});

test('malformed configuration fails before any listener or dialer starts', () => {
  for (const setting of ['RUSTDESK_ENABLE_WEBRTC', 'RUSTDESK_REQUIRE_ORIGIN', 'RUSTDESK_ALLOW_PRIVATE_TARGETS',
    'RUSTDESK_DEFAULT_FORCE_RELAY', 'RENDER']) {
    for (const value of ['Y', '1', 'treu']) assert.throws(() => parseRuntimeConfig({ [setting]: value }), new RegExp(setting));
    assert.doesNotThrow(() => parseRuntimeConfig({ [setting]: ' TRUE ' }));
    assert.doesNotThrow(() => parseRuntimeConfig({ [setting]: 'false' }));
  }
  for (const port of ['0', '-1', '65536', '1.5', '1e3', '3000oops']) {
    assert.throws(() => parseRuntimeConfig({ PORT: port }), /PORT/);
    assert.throws(() => parseRuntimeConfig({ RUSTDESK_ALLOWED_TARGET_PORTS: `21116,${port}` }), /RUSTDESK_ALLOWED_TARGET_PORTS/);
  }
  for (const origin of ['https://host/path', 'https://user:pass@host', 'https:host', 'null', 'wss://host', 'https://host?secret=1']) {
    assert.throws(() => parseRuntimeConfig({ RUSTDESK_ALLOWED_ORIGINS: origin }), /RUSTDESK_ALLOWED_ORIGINS/);
  }
  assert.throws(() => parseRuntimeConfig({ RUSTDESK_TRUSTED_PROXIES: '*' }), /RUSTDESK_TRUSTED_PROXIES/);
  assert.throws(() => parseRuntimeConfig({ RUSTDESK_CLIENT_IP_HEADER: 'forwarded' }), /RUSTDESK_CLIENT_IP_HEADER/);
  assert.throws(() => parseRuntimeConfig({ HOST: 'localhost:3000' }), /HOST/);
  assert.throws(() => parseRuntimeConfig({ NODE_ENV: 'prodution' }), /NODE_ENV/);
});

test('production token normalization never returns or logs a rejected token in errors', () => {
  for (const token of ['', '  ', 'CHANGE_ME', '"YOUR_GATEWAY_TOKEN"']) {
    assert.throws(() => parseRuntimeConfig({ ...production, RUSTDESK_GATEWAY_TOKEN: token }), /Set RUSTDESK_GATEWAY_TOKEN/);
  }
  assert.equal(parseRuntimeConfig({ ...production, RUSTDESK_GATEWAY_TOKEN: ' "test-token" ' }).gatewayToken, 'test-token');
  assert.throws(() => parseRuntimeConfig({ ...production, PORT: 'secret-like-invalid-value' }), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes('secret-like-invalid-value'), false);
    assert.equal(error.message.includes(production.RUSTDESK_GATEWAY_TOKEN), false);
    return true;
  });
});

test('Render public origin comes only from the documented deployment URL and explicit allowlists win', () => {
  const renderEnv = { ...production, RENDER: 'true', RENDER_EXTERNAL_URL: 'https://rustdesk-web-client.onrender.com' };
  const config = parseRuntimeConfig(renderEnv);
  assert.equal(config.host, '0.0.0.0');
  assert.equal(config.allowedOrigins, renderEnv.RENDER_EXTERNAL_URL);
  assert.equal(originAllowed(renderEnv.RENDER_EXTERNAL_URL, 'internal:3000', config.allowedOrigins, true, {
    protocol: config.requestProtocol('192.0.2.1', {}),
  }), true);
  assert.equal(originAllowed('https://attacker.onrender.com', 'internal:3000', config.allowedOrigins, true), false);
  assert.equal(originAllowed('http://rustdesk-web-client.onrender.com', 'internal:3000', config.allowedOrigins, true), false);
  assert.equal(parseRuntimeConfig({ ...renderEnv, RENDER: 'false' }).allowedOrigins, '');
  assert.equal(parseRuntimeConfig({ ...renderEnv, RUSTDESK_ALLOWED_ORIGINS: 'HTTPS://DESK.EXAMPLE:443' }).allowedOrigins, 'https://desk.example');
  assert.equal(parseRuntimeConfig({ ...renderEnv, RUSTDESK_ALLOWED_ORIGINS: '*' }).allowedOrigins, '*');
  for (const url of ['http://app.onrender.com', 'https://app.onrender.com/extra', 'https://app.onrender.com.evil.test',
    'https://app.onrender.com:444', 'https://user@app.onrender.com']) {
    assert.throws(() => parseRuntimeConfig({ ...renderEnv, RENDER_EXTERNAL_URL: url }), /RENDER_EXTERNAL_URL/);
  }
});

test('a parsed runtime snapshot is immutable and can be injected without mutating process.env', () => {
  const env = { ...production, RUSTDESK_TRUSTED_PROXIES: '127.0.0.1', RUSTDESK_DEFAULT_FORCE_RELAY: 'true' };
  const config = parseRuntimeConfig(env);
  const restore = setRuntimeConfig(config);
  try {
    env.RUSTDESK_DEFAULT_FORCE_RELAY = 'false';
    env.RUSTDESK_TRUSTED_PROXIES = '';
    assert.equal(getRuntimeConfig(), config);
    assert.equal(getRuntimeConfig().defaultForceRelay, true);
    assert.equal(config.clientAddress('127.0.0.1', { 'x-forwarded-for': '192.0.2.7' }), '192.0.2.7');
    assert.equal(config.requestProtocol('127.0.0.1', { 'x-forwarded-proto': 'https' }), 'https:');
    assert.equal(Object.isFrozen(config), true);
    assert.equal(Object.isFrozen(config.allowedTargetPorts), true);
  } finally { restore(); }
});
