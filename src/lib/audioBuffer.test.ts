import assert from 'node:assert/strict';
import test from 'node:test';
import { AUDIO_MAX_LATENCY_MS, PcmJitterBuffer } from './audioBuffer';

const rate = 48000;
const plane = (frames: number, value = 0.5) => new Float32Array(frames).fill(value);
const render = (buffer: PcmJitterBuffer, frames: number, now = 0) => {
  const output = [new Float32Array(frames), new Float32Array(frames)];
  buffer.render(output, now);
  return output;
};

test('startup waits for 40ms, fades in and preserves stereo without packet gaps', () => {
  const buffer = new PcmJitterBuffer(rate);
  buffer.push([plane(960, 0.5), plane(960, -0.25)], rate);
  assert.ok(render(buffer, 128)[0].every(value => value === 0));
  assert.equal(buffer.queuedFrames, 960);
  buffer.push([plane(960, 0.5), plane(960, -0.25)], rate);
  const output = render(buffer, 1920);
  assert.equal(output[0][0], 0);
  assert.equal(output[0][240], 0.5);
  assert.equal(output[1][240], -0.25);
  assert.ok(output[0].subarray(240).every(value => value === 0.5));
  assert.equal(buffer.queuedFrames, 0);
  assert.equal(buffer.underruns, 0);
});

test('underrun fades to silence and waits for a larger recovery buffer', () => {
  const buffer = new PcmJitterBuffer(rate);
  buffer.push([plane(1920)], rate);
  render(buffer, 1920);
  const tail = render(buffer, 480);
  assert.ok(tail[0][0] > 0 && tail[0][0] < 0.5);
  assert.ok(tail[0].subarray(240).every(value => value === 0));
  assert.equal(buffer.underruns, 1);
  assert.equal(buffer.targetFrames, 2880);
  buffer.push([plane(1920)], rate);
  assert.ok(render(buffer, 128)[0].every(value => value === 0));
  buffer.push([plane(960)], rate);
  assert.equal(render(buffer, 480)[0][300], 0.5);
  assert.equal(buffer.underruns, 1);
});

test('overload discards old PCM toward the target and never exceeds 200ms', () => {
  const buffer = new PcmJitterBuffer(rate);
  buffer.push([plane(8640, 0.1)], rate);
  buffer.push([plane(1920, 0.75)], rate);
  assert.equal(buffer.queuedFrames, 2880);
  assert.equal(buffer.droppedFrames, 7680);
  const output = render(buffer, 2880);
  assert.equal(output[0][1200], 0.75);
  buffer.push([plane(rate)], rate);
  assert.ok(buffer.queuedFrames <= rate * AUDIO_MAX_LATENCY_MS / 1000);
});

test('expired PCM is discarded even when time was spent in an upstream queue', () => {
  const buffer = new PcmJitterBuffer(rate);
  buffer.push([plane(1920)], rate, 1);
  assert.ok(render(buffer, 128, 1.201)[0].every(value => value === 0));
  assert.equal(buffer.queuedFrames, 0);
  assert.equal(buffer.droppedFrames, 1920);
});

test('48k to 44.1k resampling keeps phase across arbitrary packet boundaries', () => {
  const input = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i / 30) * 0.5);
  const one = new PcmJitterBuffer(44100);
  const split = new PcmJitterBuffer(44100);
  one.push([input, Float32Array.from(input, n => -n)], rate);
  for (let start = 0; start < input.length; start += 137) {
    const part = input.subarray(start, start + 137);
    split.push([part, Float32Array.from(part, n => -n)], rate);
  }
  assert.equal(one.queuedFrames, 4410);
  assert.equal(split.queuedFrames, one.queuedFrames);
  const a = render(one, 4410);
  const b = render(split, 4410);
  assert.deepEqual(b, a);
  assert.ok(a[0].every((value, index) => Math.abs(value + a[1][index]) < 1e-6));
});

test('mono resampling duplicates channels and reset flushes old format and phase', () => {
  const buffer = new PcmJitterBuffer(rate);
  buffer.push([plane(1600)], 16000);
  assert.ok(Math.abs(buffer.queuedFrames - 4800) <= 3);
  const output = render(buffer, 3000);
  assert.deepEqual(output[0], output[1]);
  buffer.reset();
  assert.equal(buffer.queuedFrames, 0);
  assert.equal(buffer.targetFrames, 1920);
  assert.ok(render(buffer, 128)[0].every(value => value === 0));
  buffer.push([plane(1920, 0.75)], rate);
  assert.equal(render(buffer, 480)[0][300], 0.75);
});

test('stable playback slowly removes the extra underrun latency', () => {
  const buffer = new PcmJitterBuffer(rate);
  buffer.push([plane(1920)], rate);
  render(buffer, 2400);
  assert.equal(buffer.targetFrames, 2880);
  buffer.push([plane(2880)], rate);
  render(buffer, 960);
  for (let i = 0; i < 250; i++) {
    buffer.push([plane(960)], rate);
    render(buffer, 960);
  }
  assert.equal(buffer.targetFrames, 2400);
  assert.equal(buffer.underruns, 1);
});

test('stable recovery shrinks actual queued latency after repeated jitter without new underruns', () => {
  const buffer = new PcmJitterBuffer(rate);
  for (let interruption = 0; interruption < 4; interruption++) {
    buffer.push([plane(buffer.targetFrames)], rate);
    render(buffer, buffer.targetFrames + 480);
  }
  assert.equal(buffer.targetFrames, 5760);
  buffer.push([plane(buffer.targetFrames)], rate);
  render(buffer, 960);
  const initialQueue = buffer.queuedFrames;
  assert.equal(initialQueue, 4800);
  let largestJump = 0;
  let previous = 0.5;
  for (let packet = 0; packet < 250 * 8; packet++) {
    buffer.push([plane(960)], rate);
    const output = render(buffer, 960)[0];
    for (const sample of output) {
      largestJump = Math.max(largestJump, Math.abs(sample - previous));
      previous = sample;
    }
  }
  assert.equal(buffer.targetFrames, 1920);
  assert.ok(buffer.queuedFrames <= 1920, `queued=${buffer.queuedFrames}`);
  assert.ok(buffer.queuedFrames < initialQueue);
  assert.equal(buffer.underruns, 4);
  assert.ok(largestJump < 0.01, `recovery discontinuity=${largestJump}`);
});
