import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIO_HEADER_BYTES, MAX_OPUS_PACKET_BYTES, encodeAudioFrame, decodeAudioFrame } from '../../shared/audio.ts';
import { decodeFrame } from './protocol.ts';

test('RDA1 carries one exact Opus packet without copies when decoding and cannot be mistaken for video', () => {
  const packet = Uint8Array.from([0, 17, 255, 0, 123]);
  const wire = encodeAudioFrame(packet);
  assert.equal(wire.byteLength, packet.byteLength + AUDIO_HEADER_BYTES);
  assert.deepEqual(decodeAudioFrame(wire), packet);
  assert.equal(decodeAudioFrame(wire)?.buffer, wire.buffer);
  assert.equal(decodeFrame(new Uint8Array(wire).buffer), null);
  const wrapped = new Uint8Array(wire.byteLength + 9);
  wrapped.set(wire, 5);
  assert.deepEqual(decodeAudioFrame(wrapped.subarray(5, 5 + wire.length)), packet);
});

test('RDA1 rejects empty, oversized, truncated, foreign and concatenated packets', () => {
  assert.throws(() => encodeAudioFrame(new Uint8Array()));
  assert.throws(() => encodeAudioFrame(new Uint8Array(MAX_OPUS_PACKET_BYTES + 1)));
  const frame = encodeAudioFrame(new Uint8Array(MAX_OPUS_PACKET_BYTES));
  assert.equal(decodeAudioFrame(frame)?.length, MAX_OPUS_PACKET_BYTES);
  assert.equal(decodeAudioFrame(frame.subarray(0, frame.length - 1)), null);
  assert.equal(decodeAudioFrame(new Uint8Array([...frame, ...frame])), null);
  const bad = frame.slice(); bad[2] = 0x56;
  assert.equal(decodeAudioFrame(bad), null);
  for (let size = 0; size < AUDIO_HEADER_BYTES; size++) assert.equal(decodeAudioFrame(frame.subarray(0, size)), null);
});
