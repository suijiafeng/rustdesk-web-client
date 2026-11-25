// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

/** Browser origins are limited to the request host, loopback dev, or an explicit allowlist. */
export function originAllowed(origin: string, requestHost: string, allowlist: string): boolean {
  if (!origin) return true;
  const list = allowlist.split(',').map((item) => item.trim()).filter(Boolean);
  if (list.includes('*')) return true;
  if (list.length > 0) return list.includes(origin);
  let hostname = '';
  try {
    hostname = new URL(origin).hostname;
  } catch {
    return false;
  }
  const requestName = requestHost.replace(/^\[|\]$/g, '').split(':')[0] ?? '';
  if (hostname === requestName) return true;
  return LOOPBACK.has(hostname) && LOOPBACK.has(requestName);
}

export function productionTokenProblem(nodeEnv: string | undefined, token: string): string | null {
  if (nodeEnv === 'production' && token.trim().length === 0) {
    return 'Set RUSTDESK_GATEWAY_TOKEN before starting the gateway in production.';
  }
  return null;
}

/** Blocks empty targets and well-known cloud metadata addresses. */
export function targetHostAllowed(host: string): boolean {
  const text = host.trim().toLowerCase().replace(/^\[|\]$/g, '');
  if (!text || text.includes('/') || text.includes('@') || text.includes(' ')) return false;
  if (text === '169.254.169.254' || text === 'metadata.google.internal') return false;
  return true;
}
