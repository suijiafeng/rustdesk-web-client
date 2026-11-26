import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeMessage, decodeRendezvous, encodeMessage, encodeRendezvous } from '../shared/protos.ts';
import type { DecodedHostMessage, HostMessage } from '../shared/protoTypes.ts';

// These declarations are compiled by typecheck, but are never sent to a host.
function protocolTypeChecks(decoded: DecodedHostMessage): void {
  // @ts-expect-error Misspelled protocol fields must fail at compile time.
  encodeMessage({ login_request: { pasword: new Uint8Array() } });
  // @ts-expect-error Binary fields cannot silently become base64 text.
  encodeMessage({ audio_frame: { data: 'base64' } });
  // @ts-expect-error Received longs are strings, not imprecise numbers.
  const cursor: number | undefined = decoded.cursor_id;
  // @ts-expect-error Wire field presence must be checked before access.
  const hostname: string = decoded.peer_info.hostname;
  const valid: HostMessage = { cursor_id: '18446744073709551615' };
  const selector: 'error' | 'peer_info' | undefined = decoded.login_response?.union;
  void [cursor, hostname, valid, selector];
}
void protocolTypeChecks;

test('typed protobuf conversion preserves 64-bit precision, bytes and oneof selectors', () => {
  const maximumCursorId = '18446744073709551615';
  const cursor = decodeMessage(encodeMessage({ cursor_data: {
    id: maximumCursorId, colors: new Uint8Array([0, 127, 255]),
  } }));
  assert.equal(cursor.cursor_data?.id, maximumCursorId);
  assert.ok(cursor.cursor_data?.colors instanceof Uint8Array);
  assert.deepEqual([...cursor.cursor_data.colors], [0, 127, 255]);
  const echoed = decodeMessage(encodeMessage({ test_delay: { time: '9007199254740993', from_client: false } }));
  assert.equal(echoed.test_delay?.time, '9007199254740993');
  assert.deepEqual(decodeMessage(encodeMessage(echoed)), echoed);
  const rejection = decodeMessage(encodeMessage({ login_response: { error: '' } }));
  assert.equal(rejection.login_response?.union, 'error');
  assert.equal(rejection.login_response.error, '');
});

test('typed protobuf conversion leaves ordinary proto3 zero fields optional and preserves zero-valued oneofs', () => {
  const missing = decodeRendezvous(encodeRendezvous({ punch_hole_response: {} }));
  const zero = decodeRendezvous(encodeRendezvous({ punch_hole_response: { failure: 0 } }));
  assert.ok(missing.punch_hole_response);
  assert.ok(zero.punch_hole_response);
  assert.equal(Object.hasOwn(missing.punch_hole_response, 'failure'), false);
  // Proto3 scalar defaults may be omitted even when the sender supplied zero.
  // Consumers must retain their ID_NOT_EXIST fallback instead of relying on it.
  assert.equal(Object.hasOwn(zero.punch_hole_response, 'failure'), false);
  const empty = decodeMessage(encodeMessage({ misc: {} }));
  const displayZero = decodeMessage(encodeMessage({ misc: { follow_current_display: 0 } }));
  assert.equal(empty.misc?.follow_current_display, undefined);
  assert.equal(displayZero.misc?.follow_current_display, 0);
  assert.equal(displayZero.misc?.union, 'follow_current_display');
  assert.equal(decodeMessage(encodeMessage({ login_response: {} })).login_response?.union, undefined);
});
