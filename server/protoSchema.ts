import protobuf from 'protobufjs';
import { PROTO_SOURCE } from '../shared/protoSource.ts';

const parsed = protobuf.parse(PROTO_SOURCE, { keepCase: true });
export const protoRoot = parsed.root;

export const MessageProto = protoRoot.lookupType('rustdesk.Message');
export const IdPkProto = protoRoot.lookupType('rustdesk.IdPk');
export const RendezvousMessageProto = protoRoot.lookupType('rustdesk.RendezvousMessage');
export const KxParamsProto = protoRoot.lookupType('rustdesk.KxParams');

export const ControlKeyValues = protoRoot.lookupEnum('rustdesk.ControlKey').values;
export const KeyboardModeValues = protoRoot.lookupEnum('rustdesk.KeyboardMode').values;
export const ImageQualityValues = protoRoot.lookupEnum('rustdesk.ImageQuality').values;
export const BoolOptionValues = protoRoot.lookupEnum('rustdesk.OptionMessage.BoolOption').values;
export const PreferCodecValues = protoRoot.lookupEnum('rustdesk.SupportedDecoding.PreferCodec').values;
export const ChromaValues = protoRoot.lookupEnum('rustdesk.Chroma').values;
export const NatTypeValues = protoRoot.lookupEnum('rustdesk.NatType').values;
export const ConnTypeValues = protoRoot.lookupEnum('rustdesk.ConnType').values;
export const PunchFailureValues = protoRoot.lookupEnum('rustdesk.PunchHoleResponse.Failure').values;
