import { Buffer } from 'buffer';
import { IdPkProto, KxParamsProto, MessageProto, RendezvousMessageProto } from './protoSchema.ts';

export * from './protoSchema.ts';

export function encodeMessage(obj: Record<string, unknown>): Buffer {
  const msg = MessageProto.create(obj);
  return Buffer.from(MessageProto.encode(msg).finish());
}

function wrapProtoDecodeError(err: unknown, buf: Uint8Array, kind: 'host' | 'id-server'): Error {
  const head = Buffer.from(buf.subarray(0, Math.min(buf.length, 32))).toString('ascii');
  if (/(?:HTTP\/\d\.\d|<!DOCTYPE|<html|Bad Request|Not Found)/i.test(head)) {
    return new Error(
      kind === 'id-server'
        ? 'Not a RustDesk ID server: received an HTTP response instead of RustDesk protocol data.'
        : 'Not a RustDesk server: received an HTTP response instead of RustDesk protocol data.',
    );
  }
  const msg = err instanceof Error ? err.message : String(err ?? '');
  if (/invalid wire type|index out of range|illegal tag|unexpected end/i.test(msg)) {
    return new Error(
      kind === 'id-server'
        ? 'Not a RustDesk ID server: received invalid protocol data.'
        : 'Not a RustDesk server: received invalid protocol data.',
    );
  }
  return err instanceof Error ? err : new Error(msg);
}

export function decodeMessage(buf: Uint8Array): Record<string, any> {
  try {
    const decoded = MessageProto.decode(buf);
    return MessageProto.toObject(decoded, {
      bytes: Buffer,
      longs: String,
      enums: Number,
      defaults: false,
      oneofs: true,
    });
  } catch (err) {
    throw wrapProtoDecodeError(err, buf, 'host');
  }
}

export function encodeRendezvous(obj: Record<string, unknown>): Buffer {
  const msg = RendezvousMessageProto.create(obj);
  return Buffer.from(RendezvousMessageProto.encode(msg).finish());
}

export function decodeRendezvous(buf: Uint8Array): Record<string, any> {
  try {
    const decoded = RendezvousMessageProto.decode(buf);
    return RendezvousMessageProto.toObject(decoded, {
      bytes: Buffer,
      longs: String,
      enums: Number,
      defaults: false,
      oneofs: true,
    });
  } catch (err) {
    throw wrapProtoDecodeError(err, buf, 'id-server');
  }
}

export function decodeIdPk(buf: Uint8Array): { id: string; pk: Uint8Array; kx_version: number } {
  const decoded = IdPkProto.decode(buf);
  const obj = IdPkProto.toObject(decoded, { bytes: Buffer, defaults: true });
  return {
    id: String(obj.id ?? ''),
    pk: new Uint8Array(obj.pk ?? []),
    kx_version: Number(obj.kx_version ?? 0),
  };
}

export function encodeIdPk(id: string, pk: Uint8Array, kxVersion: number): Buffer {
  return Buffer.from(
    IdPkProto.encode(IdPkProto.create({ id, pk, kx_version: kxVersion })).finish(),
  );
}

export function decodeKxParams(buf: Uint8Array): { pk: Uint8Array; version: number } {
  const decoded = KxParamsProto.decode(buf);
  const obj = KxParamsProto.toObject(decoded, { bytes: Buffer, defaults: true });
  return {
    pk: new Uint8Array(obj.pk ?? []),
    version: Number(obj.version ?? 0),
  };
}

/**
 * Encodes an IPv4 or IPv6 SocketAddr identically to hbb_common::AddrMangle::encode.
 */
export function encodeAddrMangle(host: string, port: number, tmOverride?: number): Buffer {
  const ipv4Parts = host.split('.');
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d+$/.test(p))) {
    const octets = ipv4Parts.map((p) => Number(p) & 0xff);
    const ip =
      BigInt(octets[0]) |
      (BigInt(octets[1]) << 8n) |
      (BigInt(octets[2]) << 16n) |
      (BigInt(octets[3]) << 24n);
    const tm = BigInt((tmOverride ?? (Date.now() * 1000)) >>> 0);
    const p = BigInt(port & 0xffff);
    const v = ((ip + tm) << 49n) | (tm << 17n) | (p + (tm & 0xffffn));
    const bytes = Buffer.alloc(16);
    for (let i = 0; i < 16; i++) {
      bytes[i] = Number((v >> BigInt(i * 8)) & 0xffn);
    }
    let end = 16;
    while (end > 0 && bytes[end - 1] === 0) {
      end--;
    }
    return bytes.subarray(0, end);
  }

  // IPv6: 16 raw bytes + 2-byte little-endian port
  const out = Buffer.alloc(18);
  const expanded = expandIpv6(host);
  expanded.copy(out, 0);
  out.writeUInt16LE(port & 0xffff, 16);
  return out;
}

function expandIpv6(ip: string): Buffer {
  const cleaned = ip.replace(/^\[|\]$/g, '');
  const halves = cleaned.split('::');
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const missing = 8 - left.length - right.length;
  const groups = [...left, ...Array(Math.max(0, missing)).fill('0'), ...right];
  const buf = Buffer.alloc(16);
  for (let i = 0; i < 8; i++) {
    const val = parseInt(groups[i] || '0', 16) & 0xffff;
    buf.writeUInt16BE(val, i * 2);
  }
  return buf;
}

/**
 * Decodes RustDesk's hbb_common::AddrMangle binary socket address format (IPv4 or IPv6).
 * Matches upstream rustdesk/hbb_common/src/lib.rs AddrMangle::decode byte-for-byte:
 * - len > 16: must be 18 bytes (16-byte IPv6 + 2-byte little-endian port)
 * - len <= 16: right-zero-padded to 16-byte LE u128:
 *     tm = (number >> 17) & 0xFFFF_FFFF
 *     ip = ((number >> 49) - tm) as u32 LE bytes
 *     port = ((number & 0xFFFFFF) - (tm & 0xFFFF)) as u16
 */
export function decodeAddrMangle(bytes: Uint8Array): { host: string; port: number } | null {
  if (!bytes || bytes.length === 0) return null;

  if (bytes.length > 16) {
    if (bytes.length !== 18) return null;
    const parts: string[] = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
    }
    const port = bytes[16] | (bytes[17] << 8);
    if (port === 0) return null;
    return { host: parts.join(':'), port };
  }

  const padded = new Uint8Array(16);
  padded.set(bytes, 0);
  let number = 0n;
  for (let i = 0; i < 16; i++) {
    number |= BigInt(padded[i]) << BigInt(i * 8);
  }
  const tm = (number >> 17n) & 0xffffffffn;
  const ipNum = Number(((number >> 49n) - tm) & 0xffffffffn) >>> 0;
  const port = Number(((number & 0xffffffn) - (tm & 0xffffn)) & 0xffffn);
  if (port === 0) return null;

  const b0 = ipNum & 0xff;
  const b1 = (ipNum >>> 8) & 0xff;
  const b2 = (ipNum >>> 16) & 0xff;
  const b3 = (ipNum >>> 24) & 0xff;
  return { host: `${b0}.${b1}.${b2}.${b3}`, port };
}
