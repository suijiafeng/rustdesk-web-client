// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';
import { encodeBytesFrame, encodeMessage } from '@rustdesk-web/protocol';
import {
  StreamCipher,
  detectNonRustDeskProtocol,
  formatNetError,
} from './framedStream.ts';

test('kx_version 1 derives directional split keys', () => {
  const shared = new Uint8Array(crypto.randomBytes(32));
  const transcript = {
    initiatorPk: new Uint8Array(32).fill(1),
    responderPk: new Uint8Array(32).fill(2),
    advertised: 1,
    picked: 1,
  };
  const initiator = StreamCipher.fromNegotiated(shared, true, transcript);
  const responder = StreamCipher.fromNegotiated(shared, false, transcript);
  const sealed = initiator.seal(Buffer.from('ping'));
  assert.equal(Buffer.from(responder.open(sealed)).toString('utf8'), 'ping');
  const reply = responder.seal(Buffer.from('pong'));
  assert.equal(Buffer.from(initiator.open(reply)).toString('utf8'), 'pong');
});

test('detectNonRustDeskProtocol identifies HTTP, HTML, TLS, and SSH banners', () => {
  assert.equal(detectNonRustDeskProtocol(Buffer.from('HTTP/1.1 400 Bad Request\r\n\r\n')), 'http');
  assert.equal(detectNonRustDeskProtocol(Buffer.from('<!DOCTYPE html><html>')), 'http');
  assert.equal(detectNonRustDeskProtocol(Buffer.from('SSH-2.0-OpenSSH_9.6\r\n')), 'ssh');
  assert.equal(detectNonRustDeskProtocol(Buffer.from([0x16, 0x03, 0x03, 0x00, 0x20])), 'tls');
  assert.equal(
    detectNonRustDeskProtocol(encodeBytesFrame(encodeMessage({ hash: { salt: 'a', challenge: 'b' } }))),
    null,
  );
});

test('formatNetError unwraps an AggregateError with an empty top-level message', () => {
  const aggregate = new AggregateError([new Error('connect ECONNREFUSED 127.0.0.1:21116')], '');
  assert.equal(formatNetError(aggregate), 'connect ECONNREFUSED 127.0.0.1:21116');
});
