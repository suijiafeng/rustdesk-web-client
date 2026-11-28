export const SAVED_PASSWORDS_STORAGE_KEY = 'rd_web_saved_passwords';
export const REMEMBER_PASSWORD_PREF_KEY = 'rd_web_remember_password';

export type SavedPasswordMap = Record<string, string>;

export function getSavedPassword(map: SavedPasswordMap, deviceKey: string): string {
  if (!deviceKey) return '';
  return map[deviceKey] ?? '';
}

export function setSavedPassword(
  map: SavedPasswordMap,
  deviceKey: string,
  password: string,
): SavedPasswordMap {
  if (!deviceKey) return map;
  if (!password) {
    return removeSavedPassword(map, deviceKey);
  }
  if (map[deviceKey] === password) return map;
  return { ...map, [deviceKey]: password };
}

export function removeSavedPassword(
  map: SavedPasswordMap,
  deviceKey: string,
): SavedPasswordMap {
  if (!deviceKey || !(deviceKey in map)) return map;
  const next = { ...map };
  delete next[deviceKey];
  return next;
}

export function clearLegacyPasswordStorage(): void {
  try {
    window.localStorage.removeItem(SAVED_PASSWORDS_STORAGE_KEY);
    window.localStorage.removeItem(REMEMBER_PASSWORD_PREF_KEY);
  } catch {
    // Some browsers block all access to local storage.
  }
}

export const PASSWORD_STORAGE_PREFIX = 'rd_web_device_password_v1:';
const GATEWAY_TOKEN_KEY = 'rd_web_gateway_token_v1';
const SESSION_KEY = 'rd_web_session_credentials_v1';

let cachedKeyPromise: Promise<CryptoKey> | null = null;

function passwordEncryptionKey(): Promise<CryptoKey> {
  if (cachedKeyPromise) return cachedKeyPromise;
  const promise = (async (): Promise<CryptoKey> => {
    // A read/write transaction selects one non-exportable key even if two tabs initialize together.
    const candidate = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    return new Promise((resolve, reject) => {
      const open = indexedDB.open('rd_web_keys', 1);
      open.onupgradeneeded = () => open.result.createObjectStore('keys');
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction('keys', 'readwrite');
        const store = tx.objectStore('keys');
        const read = store.get('tab-passwords');
        let key = candidate;
        read.onsuccess = () => {
          if (read.result) key = read.result;
          else store.put(candidate, 'tab-passwords');
        };
        tx.oncomplete = () => { db.close(); resolve(key); };
        tx.onabort = () => { db.close(); reject(tx.error); };
      };
    });
  })().catch((err) => {
    cachedKeyPromise = null;
    throw err;
  });
  cachedKeyPromise = promise;
  return promise;
}

function bytesFromBase64(value: string) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

async function decryptCredential(stored: string, key: CryptoKey, context?: string): Promise<unknown> {
  const { iv, data } = JSON.parse(stored);
  const algorithm: AesGcmParams = { name: 'AES-GCM', iv: bytesFromBase64(iv) };
  if (context !== undefined) algorithm.additionalData = new TextEncoder().encode(context);
  const plain = await crypto.subtle.decrypt(algorithm, key, bytesFromBase64(data));
  return JSON.parse(new TextDecoder().decode(plain));
}

export interface RestoredDevicePasswords {
  passwords: SavedPasswordMap;
  hasFailures: boolean;
}

export async function restoreDevicePasswords(): Promise<RestoredDevicePasswords> {
  const storageKeys = Object.keys(window.localStorage).filter(key => key.startsWith(PASSWORD_STORAGE_PREFIX));
  let legacy: string | null = null;
  try { legacy = window.sessionStorage.getItem(SESSION_KEY); } catch { /* Session storage may be disabled. */ }
  const passwords: SavedPasswordMap = Object.create(null);
  let hasFailures = false;
  if (!storageKeys.length && !legacy) return { passwords, hasFailures };

  const key = await passwordEncryptionKey();
  for (const storageKey of storageKeys) {
    try {
      const deviceKey = storageKey.slice(PASSWORD_STORAGE_PREFIX.length);
      const stored = window.localStorage.getItem(storageKey);
      if (stored === null) continue;
      const password = await decryptCredential(stored, key, deviceKey);
      if (!deviceKey || typeof password !== 'string') throw new Error('Invalid saved password');
      passwords[deviceKey] = password;
    } catch {
      // A corrupt or unreadable entry must not hide other devices' valid credentials.
      // Keep the encrypted entry untouched so a transient storage failure is recoverable.
      hasFailures = true;
    }
  }
  if (legacy) {
    try {
      const saved = await decryptCredential(legacy, key);
      if (!saved || Array.isArray(saved) || typeof saved !== 'object') throw new Error('Invalid saved passwords');
      let migrationComplete = true;
      for (const [deviceKey, password] of Object.entries(saved)) {
        if (Object.hasOwn(passwords, deviceKey)) continue;
        try {
          if (!deviceKey || typeof password !== 'string') throw new Error('Invalid saved password');
          if (!password) continue;
          const storageKey = PASSWORD_STORAGE_PREFIX + deviceKey;
          // Never replace a newer per-device entry with an older session credential.
          await persistDevicePassword(deviceKey, password, () => window.localStorage.getItem(storageKey) === null);
          const stored = window.localStorage.getItem(storageKey);
          if (stored === null) throw new Error('Saved password was not persisted');
          const migrated = await decryptCredential(stored, key, deviceKey);
          if (typeof migrated !== 'string') throw new Error('Invalid saved password');
          passwords[deviceKey] = migrated;
        } catch {
          hasFailures = true;
          migrationComplete = false;
        }
      }
      // Retain the old encrypted container until every entry has a durable replacement.
      if (migrationComplete) window.sessionStorage.removeItem(SESSION_KEY);
    } catch {
      hasFailures = true;
    }
  }
  return { passwords, hasFailures };
}

async function encryptCredential(value: string, context: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(context) },
    await passwordEncryptionKey(), encoder.encode(JSON.stringify(value)),
  );
  const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  return JSON.stringify({ iv: base64(iv), data: base64(new Uint8Array(encrypted)) });
}

export async function persistDevicePassword(deviceKey: string, password: string, current: () => boolean) {
  const encrypted = await encryptCredential(password, deviceKey);
  if (current()) window.localStorage.setItem(PASSWORD_STORAGE_PREFIX + deviceKey, encrypted);
}

export async function restoreGatewayToken(): Promise<string> {
  const stored = window.localStorage.getItem(GATEWAY_TOKEN_KEY);
  if (!stored) return '';
  const token = await decryptCredential(stored, await passwordEncryptionKey(), GATEWAY_TOKEN_KEY);
  if (typeof token !== 'string') throw new Error('Invalid saved gateway token');
  return token;
}

export async function persistGatewayToken(token: string): Promise<void> {
  if (!token) {
    window.localStorage.removeItem(GATEWAY_TOKEN_KEY);
    return;
  }
  const encrypted = await encryptCredential(token, GATEWAY_TOKEN_KEY);
  window.localStorage.setItem(GATEWAY_TOKEN_KEY, encrypted);
}

export function forgetDevicePassword(deviceKey: string) {
  window.localStorage.removeItem(PASSWORD_STORAGE_PREFIX + deviceKey);
}

export function clearAllDevicePasswords(): void {
  try {
    const keys = Object.keys(window.localStorage).filter((key) =>
      key.startsWith(PASSWORD_STORAGE_PREFIX),
    );
    for (const key of keys) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage access errors in restricted environments.
  }
  clearLegacyPasswordStorage();
  try {
    window.sessionStorage.removeItem(SESSION_KEY);
  } catch {
    // Session storage may be disabled.
  }
}

