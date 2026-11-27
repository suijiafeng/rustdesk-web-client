import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionMode } from '../types';
import { loadDisplayPrefs, type DisplayPrefs } from '../lib/displayPrefs';
import {
  LOCALE_STORAGE_KEY,
  resolveEffectiveLocale,
  resolveLocalePreference,
  type Locale,
  type LocalePreference,
} from '../lib/i18n';
import {
  loadSavedTheme,
  persistTheme,
  resolveEffectiveTheme,
  type ThemePreference,
} from '../lib/theme';

const PREFS_STORAGE_KEY = 'rd_web_prefs';

interface SavedConnectionPrefs {
  mode?: ConnectionMode;
  directIpEnabled?: boolean;
  host?: string;
  port?: string;
  peerId?: string;
  idServer?: string;
  relayServer?: string;
  serverKey?: string;
  forceRelay?: boolean;
  webRtcOptIn?: boolean;
  touchMode?: boolean;
}

function loadSavedPrefs(): SavedConnectionPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SavedConnectionPrefs;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function usePreferences(isCoarseDevice: boolean) {
  const initialPrefs = useRef<SavedConnectionPrefs | null>(null);
  if (initialPrefs.current === null) {
    initialPrefs.current = loadSavedPrefs();
  }
  const prefs = initialPrefs.current;

  // Only non-secret connection preferences are persisted to browser storage.
  const [directIpEnabled, setDirectIpEnabled] = useState<boolean>(Boolean(prefs.directIpEnabled));
  const [mode, setMode] = useState<ConnectionMode>(
    prefs.directIpEnabled && prefs.mode === 'direct' ? 'direct' : 'id',
  );
  const [host, setHost] = useState(typeof prefs.host === 'string' ? prefs.host : '');
  const [port, setPort] = useState(typeof prefs.port === 'string' ? prefs.port : '21118');
  const [peerId, setPeerId] = useState(typeof prefs.peerId === 'string' ? prefs.peerId : '');
  const [idServer, setIdServer] = useState(typeof prefs.idServer === 'string' ? prefs.idServer : '');
  const [relayServer, setRelayServer] = useState(
    typeof prefs.relayServer === 'string' ? prefs.relayServer : '',
  );
  const [serverKey, setServerKey] = useState(
    typeof prefs.serverKey === 'string' ? prefs.serverKey : '',
  );
  const [forceRelay, setForceRelay] = useState(Boolean(prefs.forceRelay));
  const [webRtcOptIn, setWebRtcOptIn] = useState(prefs.webRtcOptIn === true);
  const [touchMode, setTouchMode] = useState(typeof prefs.touchMode === 'boolean' ? prefs.touchMode : isCoarseDevice);

  useEffect(() => {
    try {
      const next: SavedConnectionPrefs = {
        mode: directIpEnabled ? mode : 'id',
        directIpEnabled,
        host,
        port,
        peerId,
        idServer,
        relayServer,
        serverKey,
        forceRelay,
        webRtcOptIn,
        touchMode,
      };
      window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota or private-mode errors
    }
  }, [mode, directIpEnabled, host, port, peerId, idServer, relayServer, serverKey, forceRelay, webRtcOptIn, touchMode]);

  const handleToggleDirectIp = useCallback(() => {
    const next = !directIpEnabled;
    setDirectIpEnabled(next);
    if (!next) {
      setMode('id');
    }
  }, [directIpEnabled]);

  // Bilingual UI locale preference ('default' follows browser language, or explicit 'zh'/'en')
  const [localePreference, setLocalePreference] = useState<LocalePreference>(() => {
    try {
      return resolveLocalePreference(window.localStorage.getItem(LOCALE_STORAGE_KEY));
    } catch {
      return 'default';
    }
  });

  const locale: Locale = resolveEffectiveLocale(
    localePreference,
    typeof navigator !== 'undefined' ? navigator.language : null,
  );

  const changeLocale = useCallback((next: LocalePreference) => {
    setLocalePreference(next);
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
    } catch {
      // Ignore storage quota or private-mode errors
    }
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  // Theme preference (light / dark / system) synced to <html data-theme="...">
  const [theme, setTheme] = useState<ThemePreference>(() => loadSavedTheme());

  const changeTheme = useCallback((next: ThemePreference) => {
    setTheme(next);
    persistTheme(next);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const apply = () => {
      const effective = resolveEffectiveTheme(theme, Boolean(mq?.matches));
      document.documentElement.dataset.theme = effective;
    };
    apply();
    if (theme === 'system' && mq) {
      mq.addEventListener?.('change', apply);
      return () => mq.removeEventListener?.('change', apply);
    }
  }, [theme]);

  // Display preferences (persisted locally & wired end-to-end to view, quality, codec, and input)
  const [displayPrefs, setDisplayPrefs] = useState<DisplayPrefs>(() =>
    loadDisplayPrefs(isCoarseDevice || window.innerWidth <= 768),
  );
  const displayPrefsRef = useRef(displayPrefs);
  displayPrefsRef.current = displayPrefs;

  return {
    directIpEnabled,
    setDirectIpEnabled,
    mode,
    setMode,
    host,
    setHost,
    port,
    setPort,
    peerId,
    setPeerId,
    idServer,
    setIdServer,
    relayServer,
    setRelayServer,
    serverKey,
    setServerKey,
    forceRelay,
    setForceRelay,
    webRtcOptIn,
    setWebRtcOptIn,
    touchMode,
    setTouchMode,
    handleToggleDirectIp,
    localePreference,
    locale,
    changeLocale,
    theme,
    changeTheme,
    displayPrefs,
    setDisplayPrefs,
    displayPrefsRef,
  };
}
