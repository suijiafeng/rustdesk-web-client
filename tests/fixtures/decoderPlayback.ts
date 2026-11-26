import { RemoteDecoder } from '../../src/lib/decoder';
import type { VideoPacket } from '../../src/lib/protocol';

const result = { status: 'running', error: '', checks: [] as string[], violations: [] as string[] };
Object.assign(window, { decoderPlaybackResult: result });
document.addEventListener('securitypolicyviolation', event => result.violations.push(event.violatedDirective));

const check = (value: unknown, message: string) => { if (!value) throw new Error(message); };
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate: () => boolean, message: string) {
  const deadline = performance.now() + 4_000;
  while (!predicate()) {
    if (performance.now() > deadline) throw new Error(message);
    await delay(10);
  }
}

async function encodeClip(color: string): Promise<VideoPacket[]> {
  const canvas = document.createElement('canvas');
  canvas.width = 128; canvas.height = 96;
  const context = canvas.getContext('2d')!;
  const packets: VideoPacket[] = [];
  let failure: Error | undefined;
  const encoder = new VideoEncoder({
    output: chunk => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      packets.push({ codec: 1, codecName: 'vp8', key: chunk.type === 'key', display: 0,
        width: 128, height: 96, pts: chunk.timestamp / 1000, gatewayUnixMs: Date.now(), data });
    },
    error: error => { failure = error; },
  });
  try {
    encoder.configure({ codec: 'vp8', width: 128, height: 96, bitrate: 300_000, framerate: 30, latencyMode: 'realtime' });
    for (let index = 0; index < 8; index++) {
      context.fillStyle = color;
      context.fillRect(0, 0, 128, 96);
      context.fillStyle = '#ffffff';
      context.fillRect(index * 4, 0, 4, 10);
      const frame = new VideoFrame(canvas, { timestamp: index * 33_333 });
      try { encoder.encode(frame, { keyFrame: index === 0 }); } finally { frame.close(); }
    }
    await encoder.flush();
    if (failure) throw failure;
    check(packets[0]?.key && packets.some(packet => !packet.key), 'Real VP8 encoder must produce key and delta frames');
    return packets;
  } finally { if (encoder.state !== 'closed') encoder.close(); }
}

async function run() {
  let decoder: RemoteDecoder | undefined;
  try {
    check(typeof VideoEncoder !== 'undefined' && typeof VideoDecoder !== 'undefined', 'Chrome must expose real WebCodecs');
    const red = await encodeClip('#e02020');
    const green = await encodeClip('#20d040');
    const canvas = document.createElement('canvas');
    document.body.append(canvas);
    const errors: string[] = [];
    let outputs = 0;
    decoder = new RemoteDecoder({ onOutput: (width, height) => {
      check(width === 128 && height === 96, 'Decoded dimensions must be preserved');
      outputs++;
    }, onError: error => errors.push(error), onNeedRefresh: () => {} });
    decoder.push(red[0], canvas);
    await until(() => outputs > 0 || errors.length > 0, 'Initial keyframe was not drawn');
    const initial = outputs;
    for (const packet of red.slice(1)) decoder.push(packet, canvas);
    await until(() => outputs > initial || errors.length > 0, 'Delta frames were not drawn');
    check(errors.length === 0, errors.join('; '));
    const redPixel = canvas.getContext('2d')!.getImageData(64, 48, 1, 1).data;
    check(redPixel[0] > 150 && redPixel[1] < 100, 'Canvas must contain decoded video pixels');
    result.checks.push('real VP8 key and delta decoding reaches the canvas');

    decoder.close();
    check(decoder.getMetrics().decodeQueueSize === 0 && decoder.getMetrics().renderedCount === 0, 'Close must clear decoder state');
    // Discard an in-flight generation immediately before starting the next one.
    decoder.push(red[0], canvas);
    decoder.close();
    const beforeRestart = outputs;
    decoder.push(green[0], canvas);
    await until(() => outputs > beforeRestart || errors.length > 0, 'A fresh keyframe did not recover after close');
    for (const packet of green.slice(1)) decoder.push(packet, canvas);
    await delay(80);
    check(errors.length === 0, errors.join('; '));
    const greenPixel = canvas.getContext('2d')!.getImageData(64, 48, 1, 1).data;
    check(greenPixel[1] > 140 && greenPixel[0] < 100, 'Restart must paint the new generation rather than stale frames');
    const beforeClose = outputs;
    decoder.close();
    await delay(40);
    check(outputs === beforeClose, 'Closed decoder must not publish late frame callbacks');
    check(result.violations.length === 0, 'Playback must obey the production script policy');
    result.checks.push('close clears resources and a new keyframe recovers without stale output');
    result.status = 'passed';
  } catch (error) {
    result.status = 'failed'; result.error = error instanceof Error ? error.message : String(error);
  } finally { decoder?.close(); }
}
void run();
