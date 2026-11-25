// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { ProtocolError } from '../errors.ts';

/**
 * Largest payload accepted in one hbb_common BytesCodec frame.
 * The 4-byte header can name about 1 GiB; that is not a usable limit.
 */
export const MAX_FRAME_PAYLOAD = 16 * 1024 * 1024;

const INITIAL_CAPACITY = 256;

/**
 * Encodes a payload with the RustDesk BytesCodec length prefix.
 * The low 2 bits are headerLength - 1. The remaining bits are the payload length.
 */
export function encodeBytesFrame(data: Uint8Array): Uint8Array {
  const length = data.byteLength;
  if (!Number.isInteger(length) || length < 0) {
    throw new ProtocolError('invalid-frame', 'frame payload length is not a valid size');
  }
  if (length > MAX_FRAME_PAYLOAD) {
    throw new ProtocolError('frame-too-large', `frame length ${length} exceeds ${MAX_FRAME_PAYLOAD}`);
  }

  const headerLength = headerLengthFor(length);
  const out = new Uint8Array(headerLength + length);
  writeHeader(out, length, headerLength);
  out.set(data, headerLength);
  return out;
}

export class BytesFrameDecoder {
  private storage = new Uint8Array(INITIAL_CAPACITY);
  private start = 0;
  private end = 0;
  private readonly maxPayload: number;
  private readonly maxBuffered: number;

  constructor(maxPayload = MAX_FRAME_PAYLOAD) {
    if (!Number.isInteger(maxPayload) || maxPayload < 0) {
      throw new ProtocolError('invalid-frame', 'max frame payload is not a valid size');
    }
    this.maxPayload = maxPayload;
    this.maxBuffered = maxPayload + 4;
  }

  get bufferedBytes(): number {
    return this.end - this.start;
  }

  push(chunk: Uint8Array): Uint8Array[] {
    if (chunk.byteLength > 0) this.append(chunk);
    return this.takeFrames();
  }

  private append(chunk: Uint8Array): void {
    const pending = this.bufferedBytes;
    const next = pending + chunk.byteLength;
    if (next > this.maxBuffered) {
      this.reset();
      throw new ProtocolError('frame-too-large', 'buffered bytes exceed the frame limit');
    }
    this.makeRoom(chunk.byteLength);
    this.storage.set(chunk, this.end);
    this.end += chunk.byteLength;
  }

  private makeRoom(extra: number): void {
    if (this.end + extra <= this.storage.length) return;
    const pending = this.bufferedBytes;
    const needed = pending + extra;
    const grown = new Uint8Array(Math.max(needed, this.storage.length * 2));
    grown.set(this.storage.subarray(this.start, this.end), 0);
    this.storage = grown;
    this.start = 0;
    this.end = pending;
  }

  private takeFrames(): Uint8Array[] {
    const frames: Uint8Array[] = [];
    while (this.bufferedBytes > 0) {
      const headerLength = (this.storage[this.start]! & 0x03) + 1;
      if (this.bufferedBytes < headerLength) break;

      const payloadLength = readPayloadLength(this.storage, this.start, headerLength);
      if (payloadLength > this.maxPayload) {
        this.reset();
        throw new ProtocolError(
          'frame-too-large',
          `frame length ${payloadLength} exceeds ${this.maxPayload}`,
        );
      }
      const frameLength = headerLength + payloadLength;
      if (this.bufferedBytes < frameLength) break;

      const payloadStart = this.start + headerLength;
      frames.push(this.storage.slice(payloadStart, payloadStart + payloadLength));
      this.start += frameLength;
    }

    if (this.bufferedBytes === 0) this.reset();
    return frames;
  }

  private reset(): void {
    this.start = 0;
    this.end = 0;
    if (this.storage.length > 4096) this.storage = new Uint8Array(INITIAL_CAPACITY);
  }
}

function headerLengthFor(length: number): number {
  if (length <= 0x3f) return 1;
  if (length <= 0x3fff) return 2;
  if (length <= 0x3f_ffff) return 3;
  return 4;
}

function writeHeader(out: Uint8Array, length: number, headerLength: number): void {
  let value = length * 4 + (headerLength - 1);
  for (let index = 0; index < headerLength; index += 1) {
    out[index] = value & 0xff;
    value = Math.floor(value / 256);
  }
}

function readPayloadLength(bytes: Uint8Array, offset: number, headerLength: number): number {
  let value = 0;
  let place = 1;
  for (let index = 0; index < headerLength; index += 1) {
    value += bytes[offset + index]! * place;
    place *= 256;
  }
  return Math.floor(value / 4);
}
