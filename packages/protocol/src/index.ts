// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

export { ProtocolError, type ProtocolErrorCode } from './errors.ts';
export { BytesFrameDecoder, MAX_FRAME_PAYLOAD, encodeBytesFrame } from './codec/bytesFrame.ts';
export { decodeAddrMangle, encodeAddrMangle } from './codec/addrMangle.ts';
export { PROTOCOL_COMPATIBILITY } from './definitions/compatibility.ts';
export {
  BoolOption,
  Chroma,
  ClipboardFormat,
  ConnType,
  ControlKey,
  ImageQuality,
  KeyboardMode,
  NatType,
  PreferCodec,
  PunchFailure,
  decodeIdPk,
  decodeKxParams,
  decodeMessage,
  decodeRendezvous,
  encodeIdPk,
  encodeMessage,
  encodeRendezvous,
} from './definitions/messages.ts';
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
