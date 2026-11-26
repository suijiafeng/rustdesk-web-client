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
const SESSION_KEY = 'rd_web_session_credentials_v1';

async function passwordEncryptionKey(): Promise<CryptoKey> {
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
}

function forgetTabPasswords() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* Browser storage unavailable. */ }
}

function bytesFromBase64(value: string) {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0));
}

async function decryptPasswordData(stored: string, key: CryptoKey, deviceKey?: string): Promise<unknown> {
  const { iv, data } = JSON.parse(stored);
  const algorithm: AesGcmParams = { name: 'AES-GCM', iv: bytesFromBase64(iv) };
  if (deviceKey !== undefined) algorithm.additionalData = new TextEncoder().encode(deviceKey);
  const plain = await crypto.subtle.decrypt(algorithm, key, bytesFromBase64(data));
  return JSON.parse(new TextDecoder().decode(plain));
}

export async function restoreDevicePasswords(): Promise<SavedPasswordMap> {
  const storageKeys = Object.keys(window.localStorage).filter(key => key.startsWith(PASSWORD_STORAGE_PREFIX));
  let legacy: string | null = null;
  try { legacy = window.sessionStorage.getItem(SESSION_KEY); } catch { /* Session storage may be disabled. */ }
  if (!storageKeys.length && !legacy) return {};

  const key = await passwordEncryptionKey();
  const passwords: SavedPasswordMap = Object.create(null);
  for (const storageKey of storageKeys) {
    const deviceKey = storageKey.slice(PASSWORD_STORAGE_PREFIX.length);
    const stored = window.localStorage.getItem(storageKey);
    if (!stored) continue;
    const password = await decryptPasswordData(stored, key, deviceKey);
    if (typeof password !== 'string') throw new Error('Invalid saved password');
    passwords[deviceKey] = password;
  }
  if (legacy) {
    const saved = await decryptPasswordData(legacy, key);
    if (!saved || Array.isArray(saved) || typeof saved !== 'object') throw new Error('Invalid saved passwords');
    for (const [deviceKey, password] of Object.entries(saved)) {
      if (typeof password !== 'string' || !password || passwords[deviceKey]) continue;
      const storageKey = PASSWORD_STORAGE_PREFIX + deviceKey;
      await persistDevicePassword(deviceKey, password, () => window.localStorage.getItem(storageKey) === null);
      const stored = window.localStorage.getItem(storageKey);
      if (!stored) continue;
      const migrated = await decryptPasswordData(stored, key, deviceKey);
      if (typeof migrated === 'string') passwords[deviceKey] = migrated;
    }
    forgetTabPasswords();
  }
  return passwords;
}

export async function persistDevicePassword(deviceKey: string, password: string, current: () => boolean) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoder = new TextEncoder();
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: encoder.encode(deviceKey) },
    await passwordEncryptionKey(), encoder.encode(JSON.stringify(password)),
  );
  const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  if (current()) window.localStorage.setItem(PASSWORD_STORAGE_PREFIX + deviceKey,
    JSON.stringify({ iv: base64(iv), data: base64(new Uint8Array(encrypted)) }));
}

export function forgetDevicePassword(deviceKey: string) {
  window.localStorage.removeItem(PASSWORD_STORAGE_PREFIX + deviceKey);
}
