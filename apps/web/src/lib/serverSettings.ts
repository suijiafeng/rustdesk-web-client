// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

export interface ConnectionSettings {
  idServer: string;
  relayServer: string;
  serverKey: string;
  forceRelay: boolean;
}

export const DEFAULT_CONNECTION_SETTINGS: ConnectionSettings = {
  idServer: '',
  relayServer: '',
  serverKey: '',
  forceRelay: false,
};

export function validateServerAddress(value: string, required: boolean): string | null {
  const text = value.trim();
  if (!text) return required ? 'Enter the server address.' : null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(text) && !/^https?:\/\//i.test(text)) {
    const after = text.slice(text.indexOf(':') + 1);
    if (!/^\d{1,5}$/.test(after)) return 'Use a host name or an http(s) URL.';
  }
  if (text.includes('@')) return 'Do not put credentials in the server address.';
  try {
    const url = new URL(text.includes('://') ? text : `http://${text}`);
    if (!url.hostname || url.username || url.password) return 'Enter a host name without credentials.';
  } catch {
    return 'Enter a valid server address.';
  }
  return null;
}

export function validateServerKey(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  if (!/^[A-Za-z0-9+/=]+$/.test(text) || text.length < 16 || text.length > 128) {
    return 'The server public key must be base64.';
  }
  return null;
}

export function connectionSettingsError(settings: ConnectionSettings): string | null {
  return validateServerAddress(settings.idServer, false)
    ?? validateServerAddress(settings.relayServer, false)
    ?? validateServerKey(settings.serverKey);
}
