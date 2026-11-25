// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import protobuf from 'protobufjs';
import { ProtocolError } from '../errors.ts';
import { RUSTDESK_PROTO } from './rustdesk.proto.ts';

const root = protobuf.parse(RUSTDESK_PROTO, { keepCase: true }).root;

const MessageType = root.lookupType('rustdesk.Message');
const IdPkType = root.lookupType('rustdesk.IdPk');
const RendezvousType = root.lookupType('rustdesk.RendezvousMessage');
const KxParamsType = root.lookupType('rustdesk.KxParams');

function enumValues(name: string): Record<string, number> {
  return root.lookupEnum(name).values as unknown as Record<string, number>;
}

export const ControlKey = enumValues('rustdesk.ControlKey');
export const KeyboardMode = enumValues('rustdesk.KeyboardMode');
export const ImageQuality = enumValues('rustdesk.ImageQuality');
export const BoolOption = enumValues('rustdesk.OptionMessage.BoolOption');
export const PreferCodec = enumValues('rustdesk.SupportedDecoding.PreferCodec');
export const Chroma = enumValues('rustdesk.Chroma');
export const ClipboardFormat = enumValues('rustdesk.ClipboardFormat');
export const HostPermission = enumValues('rustdesk.PermissionInfo.Permission');
export const NatType = enumValues('rustdesk.NatType');
export const ConnType = enumValues('rustdesk.ConnType');
export const PunchFailure = enumValues('rustdesk.PunchHoleResponse.Failure');

const objectOptions = {
  longs: String,
  enums: Number,
  defaults: false,
  oneofs: true,
} as const;

export function encodeMessage(value: Record<string, unknown>): Uint8Array {
  return MessageType.encode(MessageType.create(value)).finish();
}

export function decodeMessage(bytes: Uint8Array): Record<string, any> {
  return decodeType(MessageType, bytes, 'host');
}

export function encodeRendezvous(value: Record<string, unknown>): Uint8Array {
  return RendezvousType.encode(RendezvousType.create(value)).finish();
}

export function decodeRendezvous(bytes: Uint8Array): Record<string, any> {
  return decodeType(RendezvousType, bytes, 'id-server');
}

export function encodeIdPk(id: string, pk: Uint8Array, kxVersion: number, dtlsFingerprint?: string): Uint8Array {
  return IdPkType.encode(IdPkType.create({ id, pk, kx_version: kxVersion, dtls_fingerprint: dtlsFingerprint })).finish();
}

export function decodeIdPk(bytes: Uint8Array): { id: string; pk: Uint8Array; kx_version: number; dtlsFingerprint?: string } {
  const obj = IdPkType.toObject(IdPkType.decode(bytes), { ...objectOptions, bytes: Array, defaults: true });
  return {
    id: String(obj.id ?? ''),
    pk: new Uint8Array(obj.pk ?? []),
    kx_version: Number(obj.kx_version ?? 0),
    ...(obj.dtls_fingerprint ? { dtlsFingerprint: String(obj.dtls_fingerprint) } : {}),
  };
}

export function decodeKxParams(bytes: Uint8Array): { pk: Uint8Array; version: number } {
  const obj = KxParamsType.toObject(KxParamsType.decode(bytes), { ...objectOptions, bytes: Array, defaults: true });
  return {
    pk: new Uint8Array(obj.pk ?? []),
    version: Number(obj.version ?? 0),
  };
}

function decodeType(
  type: protobuf.Type,
  bytes: Uint8Array,
  kind: 'host' | 'id-server',
): Record<string, any> {
  try {
    return type.toObject(type.decode(bytes), { ...objectOptions, bytes: Array }) as Record<string, unknown>;
  } catch (error) {
    throw wrapDecodeError(error, bytes, kind);
  }
}

function wrapDecodeError(error: unknown, bytes: Uint8Array, kind: 'host' | 'id-server'): Error {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, Math.min(bytes.length, 32)));
  const target = kind === 'id-server' ? 'ID server' : 'server';
  if (/(?:HTTP\/\d\.\d|<!DOCTYPE|<html|Bad Request|Not Found)/i.test(head)) {
    return new ProtocolError(
      'not-rustdesk',
      `Not a RustDesk ${target}: received an HTTP response instead of RustDesk protocol data.`,
    );
  }
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (/invalid wire type|index out of range|illegal tag|unexpected end/i.test(message)) {
    return new ProtocolError('not-rustdesk', `Not a RustDesk ${target}: received invalid protocol data.`);
  }
  return error instanceof Error ? error : new ProtocolError('invalid-message', message);
}
