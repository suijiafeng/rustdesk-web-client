import type { IncomingHttpHeaders } from 'node:http';
import { BlockList, isIP } from 'node:net';

function normalizeAddress(raw: string): string | null {
  const address = raw.trim();
  const version = isIP(address);
  if (!version || address.includes('%')) return null;
  if (version === 4) return address;

  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}

/** Compile once at startup; a bad trust policy must not silently weaken request checks. */
function createTrustedProxyChecker(env: NodeJS.ProcessEnv) {
  const trusted = new BlockList();
  for (const item of (env.RUSTDESK_TRUSTED_PROXIES ?? '').split(',')) {
    const entry = item.trim();
    if (!entry) continue;
    const parts = entry.split('/');
    const address = normalizeAddress(parts[0]);
    let prefix = parts.length === 2 && /^\d+$/.test(parts[1]) ? Number(parts[1]) : NaN;
    const originalVersion = isIP(parts[0].trim());
    if (!address || parts.length > 2 || (parts.length === 2 &&
        (!Number.isInteger(prefix) || prefix < 0 || prefix > (originalVersion === 4 ? 32 : 128)))) {
      throw new Error('RUSTDESK_TRUSTED_PROXIES must contain only valid IP addresses or CIDR ranges.');
    }
    const family = isIP(address) === 4 ? 'ipv4' : 'ipv6';
    if (parts.length === 1) {
      trusted.addAddress(address, family);
    } else {
      if (originalVersion === 6 && family === 'ipv4') {
        if (prefix < 96) throw new Error('IPv4-mapped RUSTDESK_TRUSTED_PROXIES ranges require a prefix of at least 96.');
        prefix -= 96;
      }
      trusted.addSubnet(address, prefix, family);
    }
  }

  return (raw: string | undefined): boolean => {
    const address = normalizeAddress(raw ?? '');
    return address !== null && trusted.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');
  };
}

/** Only the immediate trusted ingress may describe the browser-facing protocol. */
export function createRequestProtocolResolver(env: NodeJS.ProcessEnv) {
  const isTrusted = createTrustedProxyChecker(env);
  return (remoteAddress: string | undefined, headers: IncomingHttpHeaders, encrypted = false): 'http:' | 'https:' | null => {
    const forwarded = headers['x-forwarded-proto'];
    if (isTrusted(remoteAddress) && forwarded !== undefined) {
      if (typeof forwarded !== 'string') return null;
      const protocol = forwarded.trim().toLowerCase();
      // The ingress must overwrite this header, rather than append an untrusted chain.
      return protocol === 'http' || protocol === 'https' ? `${protocol}:` : null;
    }
    return encrypted ? 'https:' : 'http:';
  };
}

export function createClientAddressResolver(env: NodeJS.ProcessEnv) {
  const isTrusted = createTrustedProxyChecker(env);

  const header = env.RUSTDESK_CLIENT_IP_HEADER?.trim().toLowerCase() || 'x-forwarded-for';
  if (header !== 'x-forwarded-for' && header !== 'cf-connecting-ip') {
    throw new Error('RUSTDESK_CLIENT_IP_HEADER must be x-forwarded-for or cf-connecting-ip.');
  }
  return (remoteAddress: string | undefined, headers: IncomingHttpHeaders): string => {
    const peer = normalizeAddress(remoteAddress ?? '');
    if (!peer) return remoteAddress || 'unknown';
    if (!isTrusted(peer)) return peer;
    const forwarded = headers[header];
    if (typeof forwarded !== 'string') return peer;

    // This mode requires an explicitly configured ingress that overwrites this header.
    if (header === 'cf-connecting-ip') return normalizeAddress(forwarded) ?? peer;

    const hops = forwarded.split(',');
    for (let index = hops.length - 1; index >= 0; index--) {
      const address = normalizeAddress(hops[index]);
      if (!address) return peer;
      if (!isTrusted(address)) return address;
    }
    return peer;
  };
}
