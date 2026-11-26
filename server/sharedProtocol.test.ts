import assert from 'node:assert/strict';
import test from 'node:test';
import { zstdCompressSync } from 'node:zlib';
import { CursorShapes as BrowserCursorShapes } from '../shared/cursor.ts';
import { CursorShapes as GatewayCursorShapes } from './cursor.ts';
import { HostPermission, PrivacyState, privacyResult, supportsModernDisplayControls } from '../shared/peer.ts';
import { protoRoot } from '../shared/protoSchema.ts';

test('both transports decode and bound cursor shapes using the same frame validation', () => {
  const pixels = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255]);
  const compressed = zstdCompressSync(pixels);
  for (const CursorShapes of [BrowserCursorShapes, GatewayCursorShapes]) {
    const shapes = new CursorShapes();
    const cursor = { id: 'cursor', width: 2, height: 1, hotx: 99, hoty: -2, colors: compressed };
    assert.deepEqual(shapes.decode(cursor), {
      width: 2, height: 1, hotX: 1, hotY: 0, rgba: pixels.toString('base64'),
    });
    assert.notEqual(shapes.get('cursor'), null);
    assert.equal(shapes.decode({ ...cursor, colors: Buffer.concat([compressed, compressed]) }), null);
    assert.equal(shapes.get('cursor'), null, 'invalid replacements must invalidate the old shape');
    assert.equal(shapes.decode({ ...cursor, colors: compressed.subarray(0, compressed.length - 1) }), null);
    assert.equal(shapes.decode({ ...cursor, width: 1 }), null);
    assert.equal(shapes.decode({ ...cursor, width: 0.5 }), null);
    assert.equal(shapes.decode({ ...cursor, width: 513 }), null);
    for (let id = 0; id < 17; id++) shapes.decode({ ...cursor, id: String(id) });
    assert.equal(shapes.get('0'), null);
    assert.notEqual(shapes.get('16'), null);
  }
});

test('browser cursor rejects oversized and unknown zstd sizes before calling its decoder', () => {
  let decoded = 0;
  const shapes = new BrowserCursorShapes(() => { decoded++; return new Uint8Array(4); });
  const cursor = { width: 1, height: 1 };
  assert.equal(shapes.decode({ ...cursor, colors: zstdCompressSync(Buffer.alloc(1024 * 1024)) }), null);
  // Non-single-segment frame without a frame content size must not reach fzstd.
  assert.equal(shapes.decode({ ...cursor, colors: Uint8Array.from([0x28, 0xb5, 0x2f, 0xfd, 0, 0, 1, 0, 0]) }), null);
  assert.equal(decoded, 0);
});

test('shared permission numbers match the protobuf contract including zero', () => {
  const values = protoRoot.lookupEnum('rustdesk.PermissionInfo.Permission').values;
  assert.deepEqual(HostPermission, { ...values });
  assert.deepEqual(privacyResult(PrivacyState.Enabled), { enabled: true, failed: false });
  assert.deepEqual(privacyResult(PrivacyState.Disabled), { enabled: false, failed: false });
  assert.deepEqual(privacyResult(PrivacyState.Unsupported), { enabled: false, failed: true });
});

test('both transports select modern display controls starting with RustDesk 1.2.4', () => {
  for (const version of [undefined, '', 'broken', '1.2.3', '1.1.99']) assert.equal(supportsModernDisplayControls(version), false);
  for (const version of ['1.2.4', '1.3.0', '1.5.3', '2.0.0']) assert.equal(supportsModernDisplayControls(version), true);
});


test('HEVC fallback recognizes random access slices and never treats parameter sets as keyframes', async () => {
  const { encodedFrameIsKey, CODEC_H265, CODEC_AV1 } = await import('../shared/video.ts');
  for (const type of [16, 17, 18, 19, 20, 21]) {
    for (const prefix of [[0, 0, 1], [0, 0, 0, 1]]) {
      assert.equal(encodedFrameIsKey(CODEC_H265, Uint8Array.from([...prefix, type << 1, 1, 128])), true);
    }
  }
  for (const type of [0, 1, 22, 23, 32, 33, 34, 39]) {
    assert.equal(encodedFrameIsKey(CODEC_H265, Uint8Array.from([0, 0, 1, type << 1, 1, 128])), false);
  }
  assert.equal(encodedFrameIsKey(CODEC_H265, Uint8Array.from([0, 0, 1, 19 << 1, 0, 128])), false);
  assert.equal(encodedFrameIsKey(CODEC_H265, Uint8Array.from([0, 0, 1, 19 << 1, 1])), false);
  assert.equal(encodedFrameIsKey(CODEC_AV1, Uint8Array.from([0x0a, 0]), false), false);
  assert.equal(encodedFrameIsKey(CODEC_AV1, Uint8Array.from([0x0a, 0]), true), true);
});
