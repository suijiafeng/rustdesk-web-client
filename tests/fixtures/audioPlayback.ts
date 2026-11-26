import { RemoteAudio } from '../../src/lib/remoteAudio';

const result = {
  status: 'running', stage: 'encoding', error: '', errors: 0, outputRate: 0,
  stereoSamples: 0, resumedSamples: 0, monoSamples: 0, workletNodes: 0, closed: false,
  violations: [] as { directive: string; blockedURI: string }[],
};
Object.assign(window, { audioResult: result });
document.addEventListener('securitypolicyviolation', event => result.violations.push({
  directive: event.violatedDirective, blockedURI: event.blockedURI,
}));
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
function check(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }

async function encode(channels: number) {
  const packets: { data: string; duration: number }[] = [];
  let failure: DOMException | null = null;
  const encoder = new AudioEncoder({
    output(chunk) {
      const bytes = new Uint8Array(chunk.byteLength);
      chunk.copyTo(bytes);
      packets.push({ data: btoa(String.fromCharCode(...bytes)), duration: (chunk.duration ?? 20000) / 1000 });
    },
    error(error) { failure = error; },
  });
  try {
    encoder.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: channels, bitrate: 128000 });
    for (let packet = 0; packet < 50; packet++) {
      const data = new Float32Array(960 * channels);
      for (let channel = 0; channel < channels; channel++) {
        const frequency = channels === 1 ? 660 : channel ? 880 : 440;
        const amplitude = channel ? 0.2 : 0.4;
        for (let frame = 0; frame < 960; frame++) {
          data[channel * 960 + frame] = amplitude * Math.sin(2 * Math.PI * frequency * (packet * 960 + frame) / 48000);
        }
      }
      const audio = new AudioData({ format: 'f32-planar', sampleRate: 48000, numberOfFrames: 960,
        numberOfChannels: channels, timestamp: packet * 20000, data });
      try { encoder.encode(audio); } finally { audio.close(); }
    }
    await encoder.flush();
    check(!failure, `AudioEncoder failed: ${failure}`);
    check(packets.length >= 40, 'Opus encoder must produce a sustained stream');
    return packets;
  } finally { encoder.close(); }
}

function amplitude(data: Float32Array, frequency: number, sampleRate: number) {
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < data.length; index++) {
    const angle = 2 * Math.PI * frequency * index / sampleRate;
    real += data[index] * Math.cos(angle);
    imaginary += data[index] * Math.sin(angle);
  }
  return Math.hypot(real, imaginary) * 2 / data.length;
}

async function run() {
  const stereo = await encode(2);
  const mono = await encode(1);
  const NativeContext = window.AudioContext;
  const NativeNode = window.AudioWorkletNode;
  const contexts: AudioContext[] = [];
  const nodes: AudioWorkletNode[] = [];
  // Capture public Web Audio nodes for measurement, preserving their native implementations.
  class TestContext extends NativeContext {
    constructor(options?: AudioContextOptions) { super({ ...options, sampleRate: 44100 }); contexts.push(this); }
  }
  class TestNode extends NativeNode {
    constructor(context: BaseAudioContext, name: string, options?: AudioWorkletNodeOptions) {
      super(context, name, options);
      nodes.push(this);
    }
  }
  Object.assign(window, { AudioContext: TestContext, AudioWorkletNode: TestNode });
  const player = new RemoteAudio(() => { result.errors++; });
  try {
    result.stage = 'loading worklet';
    await player.resume();
    check(result.errors === 0 && nodes.length === 1, 'Worklet must initialize without errors');
    const context = contexts[0];
    result.outputRate = context.sampleRate;
    const splitter = context.createChannelSplitter(2);
    const analysers = [context.createAnalyser(), context.createAnalyser()];
    const silence = context.createGain();
    silence.gain.value = 0;
    silence.connect(context.destination);
    nodes[0].connect(splitter);
    for (let channel = 0; channel < 2; channel++) {
      analysers[channel].fftSize = 2048;
      splitter.connect(analysers[channel], channel);
      analysers[channel].connect(silence);
    }
    const samples = [new Float32Array(2048), new Float32Array(2048)];
    const read = () => { analysers.forEach((analyser, channel) => analyser.getFloatTimeDomainData(samples[channel])); };
    const play = async (packets: typeof stereo, channels: number) => {
      let next = performance.now();
      let valid = 0;
      for (let index = 0; index < packets.length; index++) {
        player.push(packets[index].data);
        next += packets[index].duration;
        await delay(Math.max(0, next - performance.now()));
        check(result.errors === 0, `RemoteAudio failed at ${result.stage}`);
        read();
        if (index < 10) continue;
        if (channels === 2) {
          const left = amplitude(samples[0], 440, context.sampleRate);
          const right = amplitude(samples[1], 880, context.sampleRate);
          if (left > 0.1 && right > 0.05 &&
              left > amplitude(samples[0], 880, context.sampleRate) * 4 &&
              right > amplitude(samples[1], 440, context.sampleRate) * 4) valid++;
        } else {
          const signal = amplitude(samples[0], 660, context.sampleRate);
          const difference = samples[0].reduce((max, value, i) => Math.max(max, Math.abs(value - samples[1][i])), 0);
          if (signal > 0.1 && difference < 0.001) valid++;
        }
      }
      return valid;
    };
    result.stage = 'stereo playback';
    player.configure(48000, 2);
    result.stereoSamples = await play(stereo, 2);
    check(result.stereoSamples >= 5, `No correctly separated stereo output: ${result.stereoSamples}`);
    await delay(350);
    read();
    check(samples.every(channel => channel.every(value => Math.abs(value) < 0.001)), 'Underrun must settle to silence');

    result.stage = 'suspend and resume';
    await context.suspend();
    player.push(stereo[0].data);
    await player.resume();
    check(context.state === 'running', 'AudioContext must resume');
    result.resumedSamples = await play(stereo, 2);
    check(result.resumedSamples >= 5, 'Playback must recover after resume');

    result.stage = 'mono format switch';
    player.configure(48000, 1);
    result.monoSamples = await play(mono, 1);
    check(result.monoSamples >= 5, 'New mono format must replace old stereo and reach both outputs');
    player.close();
    player.close();
    await delay(50);
    result.closed = (context.state as AudioContextState) === 'closed';
    check(result.closed, 'Close must release AudioContext');

    result.stage = 'close during module loading';
    const cancelled = new RemoteAudio(() => { result.errors++; });
    const pending = cancelled.resume();
    cancelled.close();
    await pending;
    check(contexts[1].state === 'closed', 'Pending initialization must close its context');
    result.workletNodes = nodes.length;
    check(nodes.length === 1, 'Initialization after close must not create a late worklet');
    check(result.errors === 0, 'No playback errors expected');
    check(result.violations.length === 0, 'Audio pipeline must obey the strict CSP');
    result.status = 'passed';
  } finally {
    player.close();
    Object.assign(window, { AudioContext: NativeContext, AudioWorkletNode: NativeNode });
  }
}

void run().catch(error => { result.error = error instanceof Error ? error.message : String(error); result.status = 'failed'; });
