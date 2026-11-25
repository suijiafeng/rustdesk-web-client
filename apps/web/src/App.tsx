// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useCallback, useEffect, useRef, useState } from 'react';
import { RemoteScreen } from './components/RemoteScreen.tsx';
import { RustDeskShell, type ConnectRequest, type ConnectionField, type ConnectionMode } from './components/RustDeskShell.tsx';
import {
  loadSavedDevices,
  persistSavedDevices,
  removeDevice,
  toggleFavoriteDevice,
  type SavedDevice,
} from './lib/devices.ts';
import { loadDisplayPrefs, persistDisplayPrefs, resolveQualityLevel, resolveTargetFps, type DisplayPrefs } from './lib/displayPrefs.ts';
import { qualityCommand, remotePrivacyAllowed, shouldFollowFocusedDisplay } from './lib/displays.ts';
import { resolveEffectiveLocale, resolveInitialLocale, type Locale, type LocalePreference } from './lib/i18n.ts';
import {
  clearLegacyPasswordStorage,
  forgetTabPasswords,
  getSavedPassword,
  persistTabPasswords,
  removeSavedPassword,
  restoreTabPasswords,
  setSavedPassword,
  type SavedPasswordMap,
} from './lib/passwords.ts';
import { loadSavedTheme, persistTheme, resolveEffectiveTheme, type ThemePreference } from './lib/theme.ts';
import { useSession } from './session/useSession.ts';

const PREFS_KEY = 'rd_web_prefs';

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
}

function loadPrefs(): SavedConnectionPrefs {
  try {
    const raw = window.localStorage.getItem(PREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SavedConnectionPrefs;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function App() {
  const prefs = useState(loadPrefs)[0];
  const [directIpEnabled, setDirectIpEnabled] = useState(Boolean(prefs.directIpEnabled));
  const [mode, setMode] = useState<ConnectionMode>(
    prefs.directIpEnabled && prefs.mode === 'direct' ? 'direct' : 'id',
  );
  const [host, setHost] = useState(prefs.host ?? '');
  const [port, setPort] = useState(prefs.port ?? '21118');
  const [password, setPassword] = useState('');
  const [peerId, setPeerId] = useState(prefs.peerId ?? '');
  const [idServer, setIdServer] = useState(prefs.idServer ?? '');
  const [relayServer, setRelayServer] = useState(prefs.relayServer ?? '');
  const [serverKey, setServerKey] = useState(prefs.serverKey ?? '');
  const [forceRelay, setForceRelay] = useState(Boolean(prefs.forceRelay));
  const [gatewayToken, setGatewayToken] = useState('');
  const [devices, setDevices] = useState<SavedDevice[]>(() => loadSavedDevices());
  const [savedPasswords, setSavedPasswords] = useState<SavedPasswordMap>({});
  const [rememberPassword, setRememberPassword] = useState(false);
  const [localePreference, setLocalePreference] = useState<LocalePreference>('default');
  const [locale, setLocale] = useState<Locale>(() => resolveInitialLocale(null));
  const [theme, setTheme] = useState<ThemePreference>(() => loadSavedTheme());
  const [displayPrefs, setDisplayPrefs] = useState<DisplayPrefs>(() => loadDisplayPrefs());
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 768px)').matches);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 768px)');
    const onChange = () => setIsDesktop(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolveEffectiveTheme(
      theme,
      window.matchMedia('(prefers-color-scheme: dark)').matches,
    );
    persistTheme(theme);
  }, [theme]);

  useEffect(() => {
    try {
      window.localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          mode: directIpEnabled ? mode : 'id',
          directIpEnabled,
          host,
          port,
          peerId,
          idServer,
          relayServer,
          serverKey,
          forceRelay,
        }),
      );
    } catch {
      // Private mode can reject storage.
    }
  }, [mode, directIpEnabled, host, port, peerId, idServer, relayServer, serverKey, forceRelay]);

  useEffect(() => {
    persistSavedDevices(devices);
  }, [devices]);

  useEffect(() => {
    clearLegacyPasswordStorage();
    let current = true;
    restoreTabPasswords()
      .then((restored) => {
        if (current && restored) setSavedPasswords(restored);
      })
      .catch(() => {
        if (current) forgetTabPasswords();
      });
    return () => {
      current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    persistTabPasswords(savedPasswords, () => current).catch(() => undefined);
    return () => {
      current = false;
    };
  }, [savedPasswords]);

  const onChangeField = (field: ConnectionField, value: string) => {
    if (field === 'host') setHost(value);
    else if (field === 'port') setPort(value);
    else if (field === 'password') setPassword(value);
    else if (field === 'peerId') setPeerId(value);
    else if (field === 'idServer') setIdServer(value);
    else if (field === 'relayServer') setRelayServer(value);
    else if (field === 'serverKey') setServerKey(value);
    else setGatewayToken(value);
  };

  const formRef = useRef({
    mode,
    peerId,
    idServer,
    relayServer,
    serverKey,
    forceRelay,
    host,
    port,
    password,
    token: gatewayToken,
    displayPrefs,
  });
  formRef.current = {
    mode,
    peerId,
    idServer,
    relayServer,
    serverKey,
    forceRelay,
    host,
    port,
    password,
    token: gatewayToken,
    displayPrefs,
  };
  const rejectSavedPassword = useCallback(() => {
    const current = formRef.current;
    const key = current.mode === 'direct'
      ? `direct:${current.host}:${current.port}`
      : `id:${current.peerId.replace(/\s+/g, '')}`;
    setSavedPasswords((saved) => removeSavedPassword(saved, key));
    setPassword('');
  }, []);
  const { session, connect, disconnect, sendInput, setHeldRelease, setArmedKeys, canvasRef, frameSize, decoderError } = useSession({
    readInput: () => formRef.current,
    onPasswordRejected: rejectSavedPassword,
  });
  const onConnect = useCallback((request?: ConnectRequest) => {
    if (request?.remember && request.password) {
      const key = request.mode === 'direct'
        ? `direct:${request.host}:${request.port}`
        : `id:${(request.peerId ?? '').replace(/\s+/g, '')}`;
      setSavedPasswords((current) => setSavedPassword(current, key, request.password ?? ''));
    }
    void connect(request);
  }, [connect]);

  useEffect(() => {
    if (session.phase !== 'live') return;
    const displays = session.peer?.displays ?? [];
    if (displays.length > 1) {
      sendInput([{ type: 'followWindow', enabled: displayPrefs.followWindow }]);
    }
    if (shouldFollowFocusedDisplay(displayPrefs.followWindow, session.focusedDisplay, session.currentDisplay, displays)) {
      sendInput([{ type: 'switchDisplay', display: session.focusedDisplay ?? 0 }]);
    }
  }, [displayPrefs.followWindow, sendInput, session.currentDisplay, session.focusedDisplay, session.peer, session.phase]);

  if (session.phase === 'live') {
    const toolbarQuality = resolveQualityLevel(displayPrefs.qualityPreset, displayPrefs.customBitrate);
    return (
      <RemoteScreen
        canvasRef={canvasRef}
        frameWidth={frameSize.width}
        frameHeight={frameSize.height}
        viewOnly={displayPrefs.viewOnly}
        swapMouseButtons={displayPrefs.swapMouseButtons}
        reverseMouseWheel={displayPrefs.reverseMouseWheel}
        showRemoteCursor={displayPrefs.showRemoteCursor}
        enlargeCursor={displayPrefs.enlargeCursor}
        cursorEmbedded={session.cursorEmbedded}
        displayOrigin={session.displayOrigin}
        cursor={session.cursor}
        cursorShape={session.cursorShape}
        onMouse={sendInput}
        onKeyboard={sendInput}
        onHeldRelease={setHeldRelease}
        onArmKeys={setArmedKeys}
        onDisconnect={disconnect}
        displays={session.peer?.displays ?? []}
        currentDisplay={session.currentDisplay}
        quality={toolbarQuality}
        privacyAllowed={remotePrivacyAllowed(session.peer)}
        onSwitchDisplay={(display) => sendInput([{ type: 'switchDisplay', display }])}
        onQuality={(quality) => {
          setDisplayPrefs((current) => {
            const next = { ...current, qualityPreset: quality };
            persistDisplayPrefs(next);
            return next;
          });
          sendInput([qualityCommand(quality, resolveTargetFps(quality, displayPrefs.customFps))]);
        }}
        onToggleViewOnly={() => {
          setDisplayPrefs((current) => {
            const next = { ...current, viewOnly: !current.viewOnly };
            persistDisplayPrefs(next);
            return next;
          });
        }}
      />
    );
  }

  return (
    <RustDeskShell
      locale={locale}
      localePreference={localePreference}
      isDesktop={isDesktop}
      theme={theme}
      displayPrefs={displayPrefs}
      onChangeLocale={(next) => {
        setLocalePreference(next);
        setLocale(resolveEffectiveLocale(next, navigator.language));
      }}
      onChangeTheme={setTheme}
      onUpdateDisplayPrefs={(patch) => {
        setDisplayPrefs((current) => {
          const next = { ...current, ...patch };
          persistDisplayPrefs(next);
          return next;
        });
      }}
      mode={mode}
      directIpEnabled={directIpEnabled}
      phase={session.phase}
      host={host}
      port={port}
      password={password}
      peerId={peerId}
      idServer={idServer}
      relayServer={relayServer}
      serverKey={serverKey}
      forceRelay={forceRelay}
      gatewayToken={gatewayToken}
      authRequired={session.authRequired}
      detail={session.detail}
      decoderError={session.phase === 'error' ? session.errorMessage : decoderError}
      touchMode={!isDesktop}
      diagnosticsOpen={false}
      devices={devices}
      savedPasswords={savedPasswords}
      rememberPassword={rememberPassword}
      onChangeMode={setMode}
      onToggleDirectIp={() => {
        setDirectIpEnabled((current) => {
          if (current) setMode('id');
          return !current;
        });
      }}
      onChangeField={onChangeField}
      onChangeForceRelay={setForceRelay}
      onChangeRememberPassword={setRememberPassword}
      onClearSavedPassword={(key) => setSavedPasswords((current) => removeSavedPassword(current, key))}
      onSelectDevice={(device) => {
        setMode(device.mode);
        if (device.mode === 'direct') {
          setDirectIpEnabled(true);
          setHost(device.host ?? '');
          setPort(device.port ?? '21118');
        } else {
          setPeerId(device.peerId ?? '');
          setIdServer(device.idServer ?? idServer);
          setRelayServer(device.relayServer ?? '');
          setServerKey(device.serverKey ?? '');
          setForceRelay(Boolean(device.forceRelay));
        }
        setPassword(getSavedPassword(savedPasswords, device.key));
      }}
      onToggleFavorite={(key) => setDevices((current) => toggleFavoriteDevice(current, key))}
      onRemoveDevice={(key) => setDevices((current) => removeDevice(current, key))}
      onToggleTouchMode={() => undefined}
      onToggleDiagnostics={() => undefined}
      onConnect={onConnect}
      onDisconnect={disconnect}
      onDismissError={disconnect}
      onClose={disconnect}
    />
  );
}
