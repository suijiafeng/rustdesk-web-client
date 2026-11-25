// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

export { ProtocolError, type ProtocolErrorCode } from './errors.ts';
export { BytesFrameDecoder, MAX_FRAME_PAYLOAD, encodeBytesFrame } from './codec/bytesFrame.ts';
export { decodeAddrMangle, encodeAddrMangle } from './codec/addrMangle.ts';
export { PROTOCOL_COMPATIBILITY } from './definitions/compatibility.ts';
export {
  BoolOption,
  Chroma,
  ClipboardFormat,
  HostPermission,
  ConnType,
  ControlKey,
  ImageQuality,
  KeyboardMode,
  NatType,
  PreferCodec,
  PunchFailure,
  BoolOption as BoolOptionValues,
  Chroma as ChromaValues,
  ClipboardFormat as ClipboardFormatValues,
  ConnType as ConnTypeValues,
  ControlKey as ControlKeyValues,
  ImageQuality as ImageQualityValues,
  KeyboardMode as KeyboardModeValues,
  NatType as NatTypeValues,
  PreferCodec as PreferCodecValues,
  PunchFailure as PunchFailureValues,
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
  vp8KeyframeSize,
  type CodecIdValue,
  type Rdv1Frame,
} from './codec/rdv1.ts';

export { getEncodedVideoFrames, isHostVideoKeyframe, type HostVideoFrame } from './codec/hostVideo.ts';

export { decodeBase64, encodeBase64, decodeEndpoint, encodeEndpoint, FragmentReader,
  FRAGMENT_PAYLOAD, MAX_CANDIDATES, MAX_MESSAGE_BYTES, sdpFingerprint, validateCandidate } from './webrtc.ts';

export {
  MOUSE_TYPE_MOVE,
  MOUSE_TYPE_DOWN,
  MOUSE_TYPE_UP,
  MOUSE_TYPE_WHEEL,
  MOUSE_BUTTON_LEFT,
  MOUSE_BUTTON_RIGHT,
  MOUSE_BUTTON_WHEEL,
  type CodecCaps,
  type ClientMessage,
  selectCodecs,
  hasAnyCodec,
  packMouseMask,
  normalizeChatText,
  controlKeyEnum,
  resolvePreferCodecEnum,
  buildSupportedDecoding,
  buildLoginOptions,
  buildVideoReceivedMessage,
  buildRefreshVideoMessage,
  toHostMessage,
  humanizeError,
} from './control.ts';
