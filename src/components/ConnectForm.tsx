import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, HelpCircle, Loader2, X } from 'lucide-react';
import { deviceKeyFor, formatPeerId, type SavedDevice } from '../lib/devices';
import { statusLabel, t, type Locale } from '../lib/i18n';
import { getSavedPassword, type SavedPasswordMap } from '../lib/passwords';
import type { ConnectionField, ConnectionMode, ConnectionPhase, ConnectRequest } from '../types';
import { ErrorBanner } from './ErrorBanner';
import { PasswordModal } from './PasswordModal';
import type { ServerSettings } from './settings/IdServerModal';

interface ConnectFormProps {
  locale: Locale;
  mode: ConnectionMode;
  directIpEnabled: boolean;
  phase: ConnectionPhase;
  host: string;
  port: string;
  password: string;
  peerId: string;
  idServer: string;
  relayServer: string;
  serverKey: string;
  forceRelay: boolean;
  gatewayToken: string;
  gatewayTokenNeedsInput: boolean;
  detail: string;
  decoderError: string;
  savedPasswords: SavedPasswordMap;
  onChangeMode: (mode: ConnectionMode) => void;
  onChangeField: (field: ConnectionField, value: string) => void;
  onClearSavedPassword: (deviceKey: string) => void;
  onSelectDevice: (device: SavedDevice) => void;
  onConnect: (req?: ConnectRequest) => void;
  onDisconnect: () => void;
  onDismissError: () => void;
  openNetworkServerSetup: (highlightIdServer?: boolean) => void;
}

// Keep this hook in the shell so opening settings preserves the connection form state.
export function useConnectForm(props: ConnectFormProps) {
  const {
    mode,
    directIpEnabled,
    phase,
    host,
    port,
    password,
    peerId,
    idServer,
    relayServer,
    serverKey,
    forceRelay,
    gatewayToken,
    gatewayTokenNeedsInput,
    savedPasswords,
    onChangeField,
    onSelectDevice,
    onConnect,
    openNetworkServerSetup,
  } = props;
  const [helpHover, setHelpHover] = useState(false);
  const [helpPinned, setHelpPinned] = useState(false);
  const helpVisible = helpHover || helpPinned;

  const [heroInputError, setHeroInputError] = useState(false);
  const [heroErrorShake, setHeroErrorShake] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [promptGatewayToken, setPromptGatewayToken] = useState('');
  const [passwordPromptOpen, setPasswordPromptOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<ConnectionMode>(mode);
  const pendingConnectionRef = useRef<ConnectRequest | null>(null);

  const peerInputRef = useRef<HTMLInputElement>(null);
  const hostInputRef = useRef<HTMLInputElement>(null);
  const helpAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!helpVisible) return;
    const handlePointerDown = (ev: PointerEvent) => {
      if (helpAnchorRef.current && !helpAnchorRef.current.contains(ev.target as Node)) {
        setHelpPinned(false);
        setHelpHover(false);
      }
    };
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setHelpPinned(false);
        setHelpHover(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [helpVisible]);

  const isLive = phase === 'live';
  const isConnecting = phase === 'connecting';
  const activeMode: ConnectionMode = directIpEnabled ? mode : 'id';

  const formattedIdValue = useMemo(() => {
    const clean = peerId.replace(/\s+/g, '');
    if (/^\d+$/.test(clean) && clean.length > 3) {
      return clean.replace(/(\d{3})(?=\d)/g, '$1 ');
    }
    return peerId;
  }, [peerId]);

  const activeTargetLabel =
    pendingMode === 'id'
      ? formatPeerId(peerId)
      : `${host.trim()}${port.trim() && port.trim() !== '21118' ? `:${port.trim()}` : ''}`;

  const triggerHeroInputError = () => {
    setHeroInputError(true);
    setHeroErrorShake(false);
    window.requestAnimationFrame(() => setHeroErrorShake(true));
  };

  const pendingDeviceKey = deviceKeyFor({
    mode: pendingMode,
    peerId,
    host,
    port,
  });

  const beginConnection = (request: ConnectRequest) => {
    const requestedMode = request.mode ?? activeMode;
    pendingConnectionRef.current = request;
    setHeroInputError(false);
    setHeroErrorShake(false);
    setPendingMode(requestedMode);
    const key = deviceKeyFor({
      mode: requestedMode, peerId: request.peerId ?? peerId,
      host: request.host ?? host, port: request.port ?? port,
    });
    const saved = getSavedPassword(savedPasswords, key);
    onChangeField('password', saved);
    if (saved && !gatewayTokenNeedsInput && phase !== 'error') {
      onConnect({ ...request, mode: requestedMode, password: saved, remember: true });
      return;
    }
    setRememberPassword(Boolean(saved));
    setPromptGatewayToken(gatewayToken);
    setPasswordPromptOpen(true);
  };

  const requestConnection = (request: ConnectRequest) => {
    const requestedMode = request.mode ?? activeMode;
    if (requestedMode === 'id') {
      if (!(request.peerId ?? peerId).replace(/\s+/g, '')) {
        triggerHeroInputError();
        peerInputRef.current?.focus();
        return;
      }
      if (!(request.idServer ?? idServer).trim()) {
        pendingConnectionRef.current = request;
        setPendingMode(requestedMode);
        openNetworkServerSetup(true);
        return;
      }
    } else if (!(request.host ?? host).trim()) {
      triggerHeroInputError();
      hostInputRef.current?.focus();
      return;
    }
    beginConnection(request);
  };
  const retryConnection = () => requestConnection({ mode: activeMode, peerId, host, port });
  const handleHeroSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    retryConnection();
  };
  const continueAfterServerSetup = (settings: ServerSettings) => {
    const request = pendingConnectionRef.current;
    if (request) beginConnection({ ...request, ...settings });
  };
  const cancelServerSetup = () => {
    pendingConnectionRef.current = null;
  };

  const handleDeviceRowTap = (device: SavedDevice) => {
    onSelectDevice(device);
    requestConnection({
      mode: device.mode, peerId: device.peerId, idServer: device.idServer || idServer,
      relayServer: device.relayServer ?? relayServer, serverKey: device.serverKey ?? serverKey,
      forceRelay: device.forceRelay ?? forceRelay, host: device.host, port: device.port || '21118',
    });
  };

  const handleConfirmPasswordConnect = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordPromptOpen(false);
    onConnect({
      ...pendingConnectionRef.current,
      mode: pendingMode,
      password,
      remember: rememberPassword,
      gatewayToken: gatewayTokenNeedsInput ? promptGatewayToken : undefined,
    });
  };

  const handleIdInputChange = (raw: string) => {
    setHeroInputError(false);
    const digitsOnly = raw.replace(/\s+/g, '');
    onChangeField('peerId', /^\d*$/.test(digitsOnly) ? digitsOnly : raw);
  };

  return {
    ...props,
    isLive,
    isConnecting,
    activeMode,
    formattedIdValue,
    helpAnchorRef,
    helpVisible,
    helpPinned,
    setHelpPinned,
    setHelpHover,
    heroInputError,
    heroErrorShake,
    setHeroErrorShake,
    setHeroInputError,
    peerInputRef,
    hostInputRef,
    handleIdInputChange,
    handleHeroSubmit,
    retryConnection,
    continueAfterServerSetup,
    cancelServerSetup,
    setPromptGatewayToken,
    setPasswordPromptOpen,
    handleDeviceRowTap,
    passwordPromptOpen,
    activeTargetLabel,
    rememberPassword,
    pendingDeviceKey,
    promptGatewayToken,
    setRememberPassword,
    handleConfirmPasswordConnect,
  };
}

type ConnectFormModel = ReturnType<typeof useConnectForm>;

export function ConnectForm({ model }: { model: ConnectFormModel }) {
  const {
    locale,
    phase,
    detail,
    decoderError,
    peerId,
    host,
    port,
    directIpEnabled,
    onChangeMode,
    onChangeField,
    onDisconnect,
    onDismissError,
    openNetworkServerSetup,
    isLive,
    isConnecting,
    activeMode,
    formattedIdValue,
    helpAnchorRef,
    helpVisible,
    helpPinned,
    setHelpPinned,
    setHelpHover,
    heroInputError,
    heroErrorShake,
    setHeroErrorShake,
    setHeroInputError,
    peerInputRef,
    hostInputRef,
    handleIdInputChange,
    handleHeroSubmit,
    retryConnection,
  } = model;
  return (
    <>
      {/* Hero Remote ID / Direct IP Input Block */}
      <section className="rd-hero-container">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <h2 className="text-[18px] font-medium text-[var(--ink)] m-0">
              {t(locale, 'remoteDesktop')}
            </h2>

            <div
              ref={helpAnchorRef}
              className="relative inline-flex items-center"
              onMouseEnter={() => {
                if (window.matchMedia?.('(hover: hover)').matches) {
                  setHelpHover(true);
                }
              }}
              onMouseLeave={() => {
                if (window.matchMedia?.('(hover: hover)').matches) {
                  setHelpHover(false);
                }
              }}
            >
              <button
                type="button"
                className="inline-flex items-center justify-center w-8 h-8 rounded-full text-[var(--ink-soft)] hover:bg-[var(--rd-hover-bg)] border-0 bg-transparent"
                data-testid="remote-help-btn"
                aria-label={t(locale, 'helpButtonAria')}
                aria-expanded={helpVisible}
                aria-controls="remote-help-popover"
                onClick={() => {
                  if (helpPinned) {
                    setHelpPinned(false);
                    setHelpHover(false);
                  } else {
                    setHelpPinned(true);
                  }
                }}
              >
                <HelpCircle size={17} />
              </button>

              {helpVisible && (
                <div
                  id="remote-help-popover"
                  className="rd-help-popover"
                  data-testid="remote-help-popover"
                  role="tooltip"
                >
                  {t(locale, 'helpRemoteDesktop')}
                </div>
              )}
            </div>
          </div>

          {directIpEnabled && (
            <div
              className="rd-mode-switcher"
              role="tablist"
              aria-label={t(locale, 'connectionModeAria')}
            >
              <button
                type="button"
                role="tab"
                aria-selected={activeMode === 'id'}
                data-testid="mode-id"
                className={`rd-mode-switcher-btn${activeMode === 'id' ? ' active' : ''}`}
                onClick={() => {
                  setHeroInputError(false);
                  onChangeMode('id');
                }}
              >
                {t(locale, 'modeId')}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeMode === 'direct'}
                data-testid="mode-direct"
                className={`rd-mode-switcher-btn${activeMode === 'direct' ? ' active' : ''}`}
                onClick={() => {
                  setHeroInputError(false);
                  onChangeMode('direct');
                }}
              >
                {t(locale, 'modeDirect')}
              </button>
            </div>
          )}
        </div>

        <form onSubmit={handleHeroSubmit} noValidate>
          {activeMode === 'id' ? (
            <div
              className={`rd-hero-box${heroInputError ? ' has-error' : ''}${
                heroErrorShake ? ' rd-shake' : ''
              }`}
              data-testid="hero-input-box"
              onAnimationEnd={() => setHeroErrorShake(false)}
            >
              <div className="flex-1 min-w-0 flex flex-col justify-center">
                <label
                  htmlFor="rustdesk-peer-id"
                  className={`transition-all leading-none ${
                    peerId ? 'text-[11px] font-medium text-[var(--ink-soft)] mb-1' : 'sr-only'
                  }`}
                >
                  {t(locale, 'remoteIdLabel')}
                </label>
                <input
                  ref={peerInputRef}
                  id="rustdesk-peer-id"
                  type="text"
                  inputMode="numeric"
                  data-testid="peer-id"
                  aria-invalid={heroInputError || undefined}
                  aria-describedby={heroInputError ? 'rustdesk-hero-error' : undefined}
                  className={`rd-hero-input font-mono-tabular${peerId ? ' has-value' : ''}`}
                  value={formattedIdValue}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t(locale, 'remoteIdLabel')}
                  onChange={(e) => handleIdInputChange(e.target.value)}
                />
              </div>

              {peerId && (
                <button
                  type="button"
                  className="rd-hero-action-btn"
                  aria-label={t(locale, 'clearInput')}
                  data-tooltip={t(locale, 'clearInput')}
                  data-tooltip-pos="top"
                  onClick={() => {
                    setHeroInputError(false);
                    onChangeField('peerId', '');
                  }}
                >
                  <X size={20} />
                </button>
              )}

              <button
                type="submit"
                className="rd-hero-action-btn primary-arrow"
                data-testid="connect"
                aria-label={t(locale, 'connect')}
                data-tooltip={t(locale, 'connect')}
                data-tooltip-pos="top-end"
                disabled={isConnecting}
              >
                <ArrowRight size={24} />
              </button>
            </div>
          ) : (
            <div
              className={`rd-hero-box direct${heroInputError ? ' has-error' : ''}${
                heroErrorShake ? ' rd-shake' : ''
              }`}
              data-testid="hero-input-box"
              onAnimationEnd={() => setHeroErrorShake(false)}
            >
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <input
                  ref={hostInputRef}
                  type="text"
                  data-testid="host"
                  aria-invalid={heroInputError || undefined}
                  aria-describedby={heroInputError ? 'rustdesk-hero-error' : undefined}
                  className="rd-hero-input direct host-field font-mono-tabular"
                  value={host}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={t(locale, 'directTargetPlaceholder')}
                  onChange={(e) => {
                    setHeroInputError(false);
                    onChangeField('host', e.target.value);
                  }}
                />
                <span className="text-[var(--ink-soft)] font-mono-tabular shrink-0">:</span>
                <input
                  type="text"
                  inputMode="numeric"
                  data-testid="port"
                  className="rd-hero-input direct port-field font-mono-tabular"
                  value={port}
                  aria-label={t(locale, 'directPortLabel')}
                  placeholder="21118"
                  onChange={(e) => onChangeField('port', e.target.value)}
                />
              </div>
              <button
                type="submit"
                className="rd-hero-action-btn primary-arrow"
                data-testid="connect"
                aria-label={t(locale, 'connect')}
                data-tooltip={t(locale, 'connect')}
                data-tooltip-pos="top-end"
                disabled={isConnecting}
              >
                <ArrowRight size={24} />
              </button>
            </div>
          )}

          {heroInputError && (
            <p
              id="rustdesk-hero-error"
              className="rd-hero-err-text"
              data-testid="hero-input-error"
              role="alert"
            >
              {activeMode === 'id' ? t(locale, 'errMissingPeerId') : t(locale, 'errMissingHost')}
            </p>
          )}
        </form>

        {(isConnecting || isLive) && (
          <div className="mt-2.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`rd-status ${phase}`} data-testid="status">
                {isConnecting && <Loader2 size={12} className="animate-spin mr-1" />}
                {statusLabel(locale, phase)}
              </span>
              <p className="m-0 text-xs text-[var(--ink-soft)] truncate" data-testid="detail">
                {detail}
              </p>
            </div>
            <button
              type="button"
              className={isLive ? 'rd-btn danger' : 'rd-btn'}
              style={{ minHeight: 32, padding: '4px 10px', fontSize: 12 }}
              data-testid={isLive ? 'disconnect' : 'cancel-connect'}
              onClick={onDisconnect}
            >
              {isLive ? t(locale, 'disconnect') : t(locale, 'cancel')}
            </button>
          </div>
        )}

        {!isLive && !isConnecting && (phase === 'error' || decoderError) && (
          <ErrorBanner
            locale={locale}
            rawError={decoderError || detail}
            onDismiss={onDismissError}
            onRetry={retryConnection}
            onOpenNetworkSettings={
              activeMode === 'id' ? () => openNetworkServerSetup(false) : undefined
            }
            onRetryPassword={retryConnection}
          />
        )}
      </section>
    </>
  );
}

export function ConnectPasswordPrompt({ model }: { model: ConnectFormModel }) {
  const {
    locale,
    password,
    savedPasswords,
    gatewayTokenNeedsInput,
    isConnecting,
    onChangeField,
    onClearSavedPassword,
    passwordPromptOpen,
    activeTargetLabel,
    rememberPassword,
    pendingDeviceKey,
    promptGatewayToken,
    setRememberPassword,
    setPromptGatewayToken,
    handleConfirmPasswordConnect,
    setPasswordPromptOpen,
  } = model;
  return (
    <>
      {passwordPromptOpen && (
        <PasswordModal
          locale={locale}
          targetLabel={activeTargetLabel}
          password={password}
          rememberPassword={rememberPassword}
          hasSavedPassword={Boolean(getSavedPassword(savedPasswords, pendingDeviceKey))}
          gatewayToken={promptGatewayToken}
          authRequired={gatewayTokenNeedsInput}
          isConnecting={isConnecting}
          onChangePassword={(val) => onChangeField('password', val)}
          onChangeRememberPassword={setRememberPassword}
          onClearSavedPassword={() => {
            onClearSavedPassword(pendingDeviceKey);
            setRememberPassword(false);
            onChangeField('password', '');
          }}
          onChangeGatewayToken={setPromptGatewayToken}
          onSubmit={handleConfirmPasswordConnect}
          onClose={() => setPasswordPromptOpen(false)}
        />
      )}
    </>
  );
}
