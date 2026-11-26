import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadSavedDevices,
  persistSavedDevices,
  removeDevice,
  toggleFavoriteDevice,
  type SavedDevice,
} from '../lib/devices';
import {
  clearAllDevicePasswords,
  clearLegacyPasswordStorage,
  restoreDevicePasswords,
  restoreGatewayToken,
  persistGatewayToken,
  persistDevicePassword,
  forgetDevicePassword,
  PASSWORD_STORAGE_PREFIX,
  removeSavedPassword,
  setSavedPassword,
  type SavedPasswordMap,
} from '../lib/passwords';

function useGatewayCredentials() {
  const [savedGatewayToken, setSavedGatewayToken] = useState('');
  const [temporaryGatewayToken, setTemporaryGatewayToken] = useState<string>();
  const gatewayToken = temporaryGatewayToken ?? savedGatewayToken;
  const [gatewayTokenReady, setGatewayTokenReady] = useState(false);
  const [gatewayTokenRejected, setGatewayTokenRejected] = useState(false);
  const [gatewayTokenReadFailed, setGatewayTokenReadFailed] = useState(false);
  const gatewayTokenSaveRef = useRef(false);

  useEffect(() => {
    let active = true;
    void restoreGatewayToken().then(token => {
      if (active) setSavedGatewayToken(token);
    }).catch(() => {
      if (active) setGatewayTokenReadFailed(true);
    }).finally(() => {
      if (active) setGatewayTokenReady(true);
    });
    return () => { active = false; };
  }, []);

  const saveGatewayToken = useCallback(async (value: string) => {
    if (gatewayTokenSaveRef.current) return false;
    gatewayTokenSaveRef.current = true;
    try {
      await persistGatewayToken(value);
      setSavedGatewayToken(value);
      setTemporaryGatewayToken(undefined);
      setGatewayTokenRejected(false);
      setGatewayTokenReadFailed(false);
      return true;
    } catch {
      return false;
    } finally {
      gatewayTokenSaveRef.current = false;
    }
  }, []);

  return {
    savedGatewayToken,
    setTemporaryGatewayToken,
    gatewayToken,
    gatewayTokenReady,
    gatewayTokenRejected,
    setGatewayTokenRejected,
    gatewayTokenReadFailed,
    saveGatewayToken,
  };
}

export function useSavedDevices() {
  const gatewayCredentials = useGatewayCredentials();
  const [devices, setDevices] = useState<SavedDevice[]>(() => loadSavedDevices());

  useEffect(() => {
    persistSavedDevices(devices);
  }, [devices]);

  const [savedPasswords, setSavedPasswords] = useState<SavedPasswordMap>({});
  const passwordWrites = useRef(new Map<string, symbol>());
  const passwordMutation = useRef(0);
  const [passwordsReady, setPasswordsReady] = useState(false);
  const [passwordStorageFailed, setPasswordStorageFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const restore = async () => {
      const current = ++revision;
      const mutation = passwordMutation.current;
      try {
        const { passwords: saved, hasFailures } = await restoreDevicePasswords();
        if (active && current === revision && passwordMutation.current !== mutation) {
          void restore();
          return;
        }
        if (active && current === revision) {
          if (hasFailures) setPasswordStorageFailed(true);
          setSavedPasswords(previous => {
            for (const key of passwordWrites.current.keys()) {
              if (previous[key]) saved[key] = previous[key];
              else delete saved[key];
            }
            return saved;
          });
        }
      } catch {
        if (active && current === revision) setPasswordStorageFailed(true);
      } finally {
        if (active && current === revision) setPasswordsReady(true);
      }
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(PASSWORD_STORAGE_PREFIX)) void restore();
    };
    clearLegacyPasswordStorage();
    void restore();
    window.addEventListener('storage', storageChanged);
    return () => {
      active = false;
      window.removeEventListener('storage', storageChanged);
    };
  }, []);

  const handleClearSavedPassword = useCallback((key: string) => {
    passwordMutation.current++;
    passwordWrites.current.delete(key);
    setSavedPasswords(previous => removeSavedPassword(previous, key));
    try {
      forgetDevicePassword(key);
    } catch {
      setPasswordStorageFailed(true);
    }
  }, []);

  const handleClearAllSavedPasswords = useCallback(() => {
    passwordMutation.current++;
    passwordWrites.current.clear();
    setSavedPasswords({});
    try {
      clearAllDevicePasswords();
    } catch {
      setPasswordStorageFailed(true);
    }
  }, []);

  const rememberDevicePassword = useCallback((key: string, password: string) => {
    const write = Symbol();
    passwordMutation.current++;
    passwordWrites.current.set(key, write);
    setSavedPasswords(previous => setSavedPassword(previous, key, password));
    const current = () => passwordWrites.current.get(key) === write;
    void persistDevicePassword(key, password, current).catch(() => {
      if (current()) setPasswordStorageFailed(true);
    }).finally(() => {
      if (current()) {
        passwordWrites.current.delete(key);
        passwordMutation.current++;
      }
    });
  }, []);

  const handleToggleFavorite = useCallback((key: string) => {
    setDevices((prev) => toggleFavoriteDevice(prev, key));
  }, []);

  const handleRemoveDevice = useCallback((key: string) => {
    setDevices((prev) => removeDevice(prev, key));
    handleClearSavedPassword(key);
  }, [handleClearSavedPassword]);

  return {
    ...gatewayCredentials,
    devices,
    setDevices,
    savedPasswords,
    passwordsReady,
    passwordStorageFailed,
    setPasswordStorageFailed,
    handleClearSavedPassword,
    handleClearAllSavedPasswords,
    rememberDevicePassword,
    handleToggleFavorite,
    handleRemoveDevice,
  };
}
