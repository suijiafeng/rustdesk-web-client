/** A server public key is exactly 32 bytes in canonical, padded standard Base64. */
export function isValidServerPublicKey(value: string): boolean {
  const key = value.trim();
  if (!/^[A-Za-z0-9+/]{43}=$/.test(key)) return false;
  try {
    const decoded = atob(key);
    return decoded.length === 32 && btoa(decoded) === key;
  } catch {
    return false;
  }
}
