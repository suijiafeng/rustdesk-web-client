import type { Long } from 'protobufjs';
import type { rustdesk } from './protoTypes.generated';

// Reflection and the CSP-safe browser schema both use toObject with defaults:
// false, longs: String and oneofs: true. Ordinary proto3 zero values may be
// absent; oneof presence is preserved even for zero. Buffer is a Uint8Array.
export type DecodedProto<T> = [Extract<T, Long>] extends [never]
  ? T extends Uint8Array ? Uint8Array
    : T extends Array<infer Item> ? Array<DecodedProto<NonNullable<Item>>>
      : T extends object ? { [Key in keyof T]?: DecodedProto<NonNullable<T[Key]>> }
        : T
  : string;

// protobufjs Writer accepts decimal strings and Long-like values without a
// precision-losing number conversion (for example when echoing TestDelay).
export type ProtoInput<T> = [Extract<T, Long>] extends [never]
  ? T extends Uint8Array ? Uint8Array
    : T extends Array<infer Item> ? Array<ProtoInput<NonNullable<Item>>>
      : T extends object ? { [Key in keyof T]?: ProtoInput<NonNullable<T[Key]>> }
        : T
  : number | string | Long;

export type HostMessage = ProtoInput<rustdesk.IMessage>;
export type RendezvousMessage = ProtoInput<rustdesk.IRendezvousMessage>;
export type DecodedHostMessage = DecodedProto<rustdesk.IMessage>;
export type DecodedRendezvousMessage = DecodedProto<rustdesk.IRendezvousMessage>;
export type PeerInfo = DecodedProto<rustdesk.IPeerInfo>;
export type OptionMessage = ProtoInput<rustdesk.IOptionMessage>;
export type { rustdesk };
