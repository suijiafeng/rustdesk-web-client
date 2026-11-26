// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { BlockList, isIP } from 'node:net';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

/** Browser origins are limited to the request host, loopback dev, or an explicit allowlist. */
export function originAllowed(origin: string, requestHost: string, allowlist: string, required = false): boolean {
  if (!origin) return !required;
  const list = allowlist.split(',').map((item) => item.trim()).filter(Boolean);
  if (list.includes('*')) return true;
  if (list.length > 0) return list.includes(origin);
  let hostname = '';
  try {
    hostname = new URL(origin).hostname.replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  const requestName = requestHost.match(/^\[([^\]]+)\]/)?.[1] ?? requestHost.split(':')[0];
  if (hostname === requestName) return true;
  return LOOPBACK.has(hostname) && LOOPBACK.has(requestName);
}

export function productionTokenProblem(nodeEnv: string | undefined, token: string): string | null {
  if (nodeEnv === 'production' && token.trim().length === 0) {
    return 'Set RUSTDESK_GATEWAY_TOKEN before starting the gateway in production.';
  }
  return null;
}

const SECRET_LOG = /((?:token|password|authorization|secret|serverkey)\s*[:=]\s*)(\S+)/gi;

export function redactLog(message: string): string {
  return message.replace(SECRET_LOG, '$1[redacted]');
}

/** Blocks empty targets and well-known cloud metadata addresses. */
export function targetHostAllowed(host: string): boolean {
  const text = host.trim().toLowerCase().replace(/\.$/, '');
  return Boolean(text) && !/[\s\\/@%\[\]?#]/.test(text) && text !== 'metadata.google.internal';
}

const blocked = new BlockList();
blocked.addSubnet('0.0.0.0', 8);
blocked.addSubnet('169.254.0.0', 16);
blocked.addSubnet('224.0.0.0', 3);
blocked.addAddress('100.100.100.200');
blocked.addAddress('168.63.129.16');
blocked.addAddress('fd00:ec2::254', 'ipv6');
blocked.addSubnet('fe80::', 10, 'ipv6');

const privateV4 = new BlockList();
privateV4.addSubnet('10.0.0.0', 8);
privateV4.addSubnet('100.64.0.0', 10);
privateV4.addSubnet('127.0.0.0', 8);
privateV4.addSubnet('172.16.0.0', 12);
privateV4.addSubnet('192.168.0.0', 16);
privateV4.addSubnet('198.18.0.0', 15);

const mappedV4 = new BlockList();
mappedV4.addSubnet('::ffff:0:0', 96, 'ipv6');
const globalV6 = new BlockList();
globalV6.addSubnet('2000::', 3, 'ipv6');
const specialV6 = new BlockList();
specialV6.addSubnet('2001::', 32, 'ipv6');
specialV6.addSubnet('2002::', 16, 'ipv6');
const privateV6 = new BlockList();
privateV6.addAddress('::1', 'ipv6');
privateV6.addSubnet('fc00::', 7, 'ipv6');

export function targetAddressAllowed(address: string, allowPrivate: boolean): boolean {
  const version = isIP(address);
  if (!version || address.includes('%')) return false;
  const family = version === 4 ? 'ipv4' : 'ipv6';
  if (blocked.check(address, family)) return false;
  // BlockList applies IPv4 subnet rules to IPv4-mapped IPv6 addresses too.
  if (version === 4 || mappedV4.check(address, 'ipv6')) {
    return allowPrivate || !privateV4.check(address, family);
  }
  return (globalV6.check(address, 'ipv6') && !specialV6.check(address, 'ipv6')) ||
    (allowPrivate && privateV6.check(address, 'ipv6'));
}

export function privateTargetsAllowed(env: NodeJS.ProcessEnv): boolean {
  const setting = env.RUSTDESK_ALLOW_PRIVATE_TARGETS?.trim().toLowerCase();
  return setting ? setting === 'true' : env.NODE_ENV !== 'production';
}

export function targetPortAllowed(port: number, peerConnection: boolean, env: NodeJS.ProcessEnv): boolean {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  if (peerConnection || env.NODE_ENV !== 'production' || (port >= 21114 && port <= 21119)) return true;
  return (env.RUSTDESK_ALLOWED_TARGET_PORTS ?? '').split(',').some((value) => {
    const entry = value.trim();
    return /^\d+$/.test(entry) && Number(entry) === port;
  });
}
