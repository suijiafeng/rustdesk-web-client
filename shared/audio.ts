export const AUDIO_HEADER_BYTES = 8;
export const MAX_OPUS_PACKET_BYTES = 8192;

/** RDA1: magic + little-endian payload length, followed by one raw Opus packet. */
export function encodeAudioFrame(packet: Uint8Array): Uint8Array {
  if (!packet.byteLength || packet.byteLength > MAX_OPUS_PACKET_BYTES) throw new Error('Invalid Opus packet');
  const frame = new Uint8Array(AUDIO_HEADER_BYTES + packet.byteLength);
  frame.set([0x52, 0x44, 0x41, 0x31]);
  new DataView(frame.buffer).setUint32(4, packet.byteLength, true);
  frame.set(packet, AUDIO_HEADER_BYTES);
  return frame;
}

export function decodeAudioFrame(frame: ArrayBuffer | Uint8Array): Uint8Array | null {
  const bytes = frame instanceof Uint8Array ? frame : new Uint8Array(frame);
  if (bytes.byteLength < AUDIO_HEADER_BYTES || bytes[0] !== 0x52 || bytes[1] !== 0x44 || bytes[2] !== 0x41 || bytes[3] !== 0x31) return null;
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true);
  if (!length || length > MAX_OPUS_PACKET_BYTES || length !== bytes.byteLength - AUDIO_HEADER_BYTES) return null;
  return bytes.subarray(AUDIO_HEADER_BYTES);
}
