// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

/** Byte length of a RustDesk video frame header. */
export const FRAME_HEADER_LENGTH = 32;

export function hasRoomForHeader(byteLength: number): boolean {
  return Number.isInteger(byteLength) && byteLength >= FRAME_HEADER_LENGTH;
}

export { ProtocolError, type ProtocolErrorCode } from './errors.ts';
export { BytesFrameDecoder, MAX_FRAME_PAYLOAD, encodeBytesFrame } from './codec/bytesFrame.ts';
