// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

export { ProtocolError, type ProtocolErrorCode } from './errors.ts';
export { BytesFrameDecoder, MAX_FRAME_PAYLOAD, encodeBytesFrame } from './codec/bytesFrame.ts';
export {
  CodecId,
  FRAME_HEADER_LENGTH,
  codecName,
  decodeRdv1Frame,
  encodeRdv1Frame,
  hasRoomForHeader,
  type CodecIdValue,
  type Rdv1Frame,
} from './codec/rdv1.ts';
