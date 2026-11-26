import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useSavedDevices } from '../../src/hooks/useSavedDevices';
import { PASSWORD_STORAGE_PREFIX, persistDevicePassword, restoreDevicePasswords } from '../../src/lib/passwords';

const result = { status: 'running', checks: 0, violations: [] as string[], error: '' };
Object.assign(window, { credentialRestoreResult: result });
document.addEventListener('securitypolicyviolation', event => result.violations.push(event.violatedDirective));
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  result.checks++;
};
const storageKey = (key: string) => PASSWORD_STORAGE_PREFIX + key;
const legacyKey = 'rd_web_session_credentials_v1';
const waitFor = async (condition: () => boolean) => {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Credential hook did not finish restoring');
};

async function saveLegacy(passwords: unknown) {
  const key = await new Promise<CryptoKey>((resolve, reject) => {
    const open = indexedDB.open('rd_web_keys', 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const read = db.transaction('keys').objectStore('keys').get('tab-passwords');
      read.onsuccess = () => { db.close(); resolve(read.result); };
      read.onerror = () => { db.close(); reject(read.error); };
    };
  });
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(JSON.stringify(passwords)));
  const base64 = (bytes: Uint8Array) => btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(''));
  sessionStorage.setItem(legacyKey, JSON.stringify({ iv: base64(iv), data: base64(new Uint8Array(data)) }));
}

async function run() {
  localStorage.clear();
  sessionStorage.clear();
  await persistDevicePassword('id:valid-a', 'fixture-password-a', () => true);
  await persistDevicePassword('id:valid-b', 'fixture-password-b', () => true);
  const corrupt = new Map([
    ['id:bad-json', '{'],
    ['id:bad-base64', JSON.stringify({ iv: '!', data: '!' })],
    ['id:bad-context', localStorage.getItem(storageKey('id:valid-a'))!],
    ['id:empty-record', ''],
  ]);
  for (const [key, stored] of corrupt) localStorage.setItem(storageKey(key), stored);
  let restored = await restoreDevicePasswords();
  check(restored.hasFailures, 'Partial corruption must be reported');
  check(restored.passwords['id:valid-a'] === 'fixture-password-a', 'First valid credential must survive corruption');
  check(restored.passwords['id:valid-b'] === 'fixture-password-b', 'Later valid credential must survive corruption');
  for (const [key, stored] of corrupt) {
    check(!Object.hasOwn(restored.passwords, key), 'Invalid credential must not be returned');
    check(localStorage.getItem(storageKey(key)) === stored, 'Invalid ciphertext must remain untouched');
  }

  const mount = document.createElement('div');
  document.body.append(mount);
  const root = createRoot(mount);
  let saved: ReturnType<typeof useSavedDevices> | undefined;
  function Fixture() { saved = useSavedDevices(); return null; }
  flushSync(() => root.render(<Fixture />));
  try {
    await waitFor(() => saved?.passwordsReady === true);
    check(saved?.passwordStorageFailed, 'Hook must display the storage failure notice');
    check(saved?.savedPasswords['id:valid-b'] === 'fixture-password-b', 'Hook must retain the usable passwords');
    check(!Object.hasOwn(saved!.savedPasswords, 'id:bad-context'), 'Hook must not expose a credential under the wrong context');
  } finally { flushSync(() => root.unmount()); mount.remove(); }

  for (const key of corrupt.keys()) localStorage.removeItem(storageKey(key));
  sessionStorage.setItem(legacyKey, '{');
  restored = await restoreDevicePasswords();
  check(restored.hasFailures && restored.passwords['id:valid-a'] === 'fixture-password-a', 'Corrupt old container must not hide newer credentials');
  check(sessionStorage.getItem(legacyKey) === '{', 'Corrupt old container must not be deleted');

  await saveLegacy({ 'id:valid-a': 'older-password', 'id:migrate-a': 'migration-a', 'id:migrate-b': 'migration-b' });
  const legacy = sessionStorage.getItem(legacyKey);
  const setItem = Storage.prototype.setItem;
  Storage.prototype.setItem = function(key, value) {
    if (this === localStorage && key === storageKey('id:migrate-b')) throw new DOMException('Fixture quota', 'QuotaExceededError');
    return setItem.call(this, key, value);
  };
  try { restored = await restoreDevicePasswords(); }
  finally { Storage.prototype.setItem = setItem; }
  check(restored.hasFailures, 'A single migration write failure must be reported');
  check(restored.passwords['id:migrate-a'] === 'migration-a', 'Other legacy entries must still migrate');
  check(!Object.hasOwn(restored.passwords, 'id:migrate-b'), 'A failed migration must not claim persistence');
  check(restored.passwords['id:valid-a'] === 'fixture-password-a', 'New credentials must win over legacy entries');
  check(sessionStorage.getItem(legacyKey) === legacy, 'Partial migration must preserve its encrypted source');
  restored = await restoreDevicePasswords();
  check(!restored.hasFailures && restored.passwords['id:migrate-b'] === 'migration-b', 'A later restore must retry failed migration');
  check(sessionStorage.getItem(legacyKey) === null, 'Only complete migration removes the old container');

  localStorage.setItem(storageKey('id:collision'), '{');
  await saveLegacy({ 'id:collision': 'older-password', 'id:unrelated': 'unrelated-password' });
  restored = await restoreDevicePasswords();
  check(restored.hasFailures && !Object.hasOwn(restored.passwords, 'id:collision'), 'Older credential must not replace an unreadable newer record');
  check(restored.passwords['id:unrelated'] === 'unrelated-password', 'An unreadable collision must not stop later migration');
  check(localStorage.getItem(storageKey('id:collision')) === '{' && sessionStorage.getItem(legacyKey) !== null,
    'Colliding ciphertext and its old container must remain recoverable');

  const open = indexedDB.open;
  indexedDB.open = () => { throw new DOMException('Fixture storage unavailable', 'SecurityError'); };
  try {
    let failed = false;
    try { await restoreDevicePasswords(); } catch { failed = true; }
    check(failed, 'Global key-store failure must reject instead of returning an empty success');
  } finally { indexedDB.open = open; }
  check(result.violations.length === 0, 'Credential code must respect strict CSP');
  result.status = 'passed';
}
void run().catch(error => { result.error = error instanceof Error ? error.message : String(error); result.status = 'failed'; });
