// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import type { ConnectionMode } from '../components/RustDeskShell';

export const DEVICES_STORAGE_KEY = 'rd_web_devices';
export const MAX_SAVED_DEVICES = 20;

export interface SavedDevice {
  key: string;
  mode: ConnectionMode;
  peerId?: string;
  idServer?: string;
  relayServer?: string;
  serverKey?: string;
  forceRelay?: boolean;
  host?: string;
  port?: string;
  hostname: string;
  platform: string;
  favorite: boolean;
  lastConnectedAt: number;
}

export type RecentDevice = Omit<SavedDevice, 'key' | 'favorite' | 'lastConnectedAt'>;

/**
 * Formats 9-digit RustDesk IDs into spaced groups ("187685134" -> "187 685 134"),
 * matching the official RustDesk mobile & desktop apps.
 */
export function formatPeerId(raw: string): string {
  const clean = raw.replace(/\s+/g, '');
  if (/^\d{7,12}$/.test(clean)) {
    return clean.replace(/(\d{3})(?=\d)/g, '$1 ');
  }
  return raw.trim();
}

export function deviceKeyFor(
  input: Pick<SavedDevice, 'mode' | 'peerId' | 'host' | 'port'>,
): string {
  if (input.mode === 'id') {
    const cleanId = (input.peerId ?? '').replace(/\s+/g, '');
    return `id:${cleanId}`;
  }
  const cleanHost = (input.host ?? '').trim().toLowerCase();
  const cleanPort = (input.port ?? '21118').trim() || '21118';
  return `direct:${cleanHost}:${cleanPort}`;
}

export function upsertRecentDevice(
  list: SavedDevice[],
  entry: RecentDevice,
  nowMs: number,
  maxItems = MAX_SAVED_DEVICES,
): SavedDevice[] {
  const key = deviceKeyFor(entry);
  const existing = list.find((item) => item.key === key);
  const updated: SavedDevice = {
    ...entry,
    peerId: entry.peerId ? entry.peerId.replace(/\s+/g, '') : undefined,
    key,
    favorite: existing?.favorite ?? false,
    lastConnectedAt: nowMs,
  };
  const rest = list.filter((item) => item.key !== key);
  const merged = [updated, ...rest];
  if (merged.length <= maxItems) return merged;
  // Preserve favorites first if trimming old non-favorites
  const favorites = merged.filter((d) => d.favorite);
  const others = merged.filter((d) => !d.favorite);
  const keepOthers = Math.max(0, maxItems - favorites.length);
  return [...favorites, ...others.slice(0, keepOthers)].sort(
    (a, b) => b.lastConnectedAt - a.lastConnectedAt,
  );
}

export function toggleFavoriteDevice(list: SavedDevice[], key: string): SavedDevice[] {
  return list.map((item) =>
    item.key === key ? { ...item, favorite: !item.favorite } : item,
  );
}

export function removeDevice(list: SavedDevice[], key: string): SavedDevice[] {
  return list.filter((item) => item.key !== key);
}

export function renameDevice(list: SavedDevice[], key: string, alias: string): SavedDevice[] {
  const name = alias.trim().slice(0, 80);
  if (!name) return list;
  return list.map((item) => (item.key === key ? { ...item, hostname: name } : item));
}

function sanitizeDevice(item: unknown): SavedDevice | null {
  if (!item || typeof item !== 'object') return null;
  const record = item as Record<string, unknown>;
  if (typeof record.key !== 'string') return null;
  if (record.mode !== 'id' && record.mode !== 'direct') return null;
  return {
    key: record.key,
    mode: record.mode,
    peerId: typeof record.peerId === 'string' ? record.peerId : undefined,
    idServer: typeof record.idServer === 'string' ? record.idServer : undefined,
    relayServer: typeof record.relayServer === 'string' ? record.relayServer : undefined,
    serverKey: typeof record.serverKey === 'string' ? record.serverKey : undefined,
    forceRelay: typeof record.forceRelay === 'boolean' ? record.forceRelay : undefined,
    host: typeof record.host === 'string' ? record.host : undefined,
    port: typeof record.port === 'string' ? record.port : undefined,
    hostname: typeof record.hostname === 'string' ? record.hostname : '',
    platform: typeof record.platform === 'string' ? record.platform : '',
    favorite: record.favorite === true,
    lastConnectedAt: typeof record.lastConnectedAt === 'number' ? record.lastConnectedAt : 0,
  };
}

/** Reads a versioned store and the original unversioned array. Passwords and tokens are dropped. */
export function parseDeviceStore(raw: unknown): SavedDevice[] {
  const list = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && (raw as { version?: unknown }).version === 1 && Array.isArray((raw as { devices?: unknown }).devices)
      ? (raw as { devices: unknown[] }).devices
      : [];
  return list.map(sanitizeDevice).filter((item): item is SavedDevice => item !== null);
}

export function loadSavedDevices(): SavedDevice[] {
  try {
    const raw = window.localStorage.getItem(DEVICES_STORAGE_KEY);
    if (!raw) return [];
    return parseDeviceStore(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function persistSavedDevices(list: SavedDevice[]): void {
  try {
    window.localStorage.setItem(DEVICES_STORAGE_KEY, JSON.stringify({ version: 1, devices: parseDeviceStore(list) }));
  } catch {
    // Ignore storage quota or private-mode errors
  }
}
