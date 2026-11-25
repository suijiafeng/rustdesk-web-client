// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

/** Encodes an IPv4 or IPv6 socket address the way hbb_common::AddrMangle does. */
export function encodeAddrMangle(host: string, port: number, timeOverride?: number): Uint8Array {
  const ipv4 = host.split('.');
  if (ipv4.length === 4 && ipv4.every((part) => /^\d+$/.test(part))) {
    const octets = ipv4.map((part) => Number(part) & 0xff);
    const ip =
      BigInt(octets[0]!) |
      (BigInt(octets[1]!) << 8n) |
      (BigInt(octets[2]!) << 16n) |
      (BigInt(octets[3]!) << 24n);
    const stamp = BigInt((timeOverride ?? (Date.now() * 1000)) >>> 0);
    const wirePort = BigInt(port & 0xffff);
    const value = ((ip + stamp) << 49n) | (stamp << 17n) | (wirePort + (stamp & 0xffffn));
    const bytes = new Uint8Array(16);
    for (let index = 0; index < 16; index += 1) {
      bytes[index] = Number((value >> BigInt(index * 8)) & 0xffn);
    }
    let end = 16;
    while (end > 0 && bytes[end - 1] === 0) end -= 1;
    return bytes.subarray(0, end);
  }

  const out = new Uint8Array(18);
  out.set(expandIpv6(host), 0);
  out[16] = port & 0xff;
  out[17] = (port >> 8) & 0xff;
  return out;
}

export function decodeAddrMangle(bytes: Uint8Array): { host: string; port: number } | null {
  if (bytes.byteLength === 0) return null;
  if (bytes.byteLength > 16) {
    if (bytes.byteLength !== 18) return null;
    const groups: string[] = [];
    for (let index = 0; index < 16; index += 2) {
      groups.push(((bytes[index]! << 8) | bytes[index + 1]!).toString(16));
    }
    const port = bytes[16]! | (bytes[17]! << 8);
    if (port === 0) return null;
    return { host: groups.join(':'), port };
  }

  const padded = new Uint8Array(16);
  padded.set(bytes, 0);
  let number = 0n;
  for (let index = 0; index < 16; index += 1) {
    number |= BigInt(padded[index]!) << BigInt(index * 8);
  }
  const stamp = (number >> 17n) & 0xffff_ffffn;
  const ip = Number(((number >> 49n) - stamp) & 0xffff_ffffn) >>> 0;
  const port = Number(((number & 0xff_ffffn) - (stamp & 0xffffn)) & 0xffffn);
  if (port === 0) return null;
  return {
    host: `${ip & 0xff}.${(ip >>> 8) & 0xff}.${(ip >>> 16) & 0xff}.${(ip >>> 24) & 0xff}`,
    port,
  };
}

function expandIpv6(host: string): Uint8Array {
  const cleaned = host.replace(/^\[|\]$/g, '');
  const halves = cleaned.split('::');
  const left = halves[0] ? halves[0].split(':').filter(Boolean) : [];
  const right = halves[1] ? halves[1].split(':').filter(Boolean) : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill('0'), ...right];
  const bytes = new Uint8Array(16);
  for (let index = 0; index < 8; index += 1) {
    const value = Number.parseInt(groups[index] || '0', 16) & 0xffff;
    bytes[index * 2] = value >> 8;
    bytes[index * 2 + 1] = value & 0xff;
  }
  return bytes;
}
