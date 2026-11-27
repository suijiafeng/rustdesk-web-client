import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, HelpCircle, KeyRound, Loader2, X } from 'lucide-react';
import { useConnectForm, type ConnectFormModel, type ConnectFormProps } from '../hooks/useConnectForm';
import { formatPeerId } from '../lib/devices';
import { statusLabel, t } from '../lib/i18n';
import { getSavedPassword } from '../lib/passwords';
import { ErrorBanner } from './ErrorBanner';
import { PasswordModal } from './PasswordModal';
import { PlatformIcon } from './PeerList';
import { ConfirmDialog } from './RestartAction';

export { useConnectForm, type ConnectFormModel, type ConnectFormProps };

export function ConnectForm({ model }: { model: ConnectFormModel }) {
  const {
    locale,
    phase,
    detail,
    connectionError,
    decoderError,
    peerId,
    host,
    port,
    directIpEnabled,
    devices = [],
    savedPasswords,
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
    handleDeviceRowTap,
  } = model;

  const [acOpen, setAcOpen] = useState(false);
  const [acIndex, setAcIndex] = useState(-1);
  const [confirmDisconnectOpen, setConfirmDisconnectOpen] = useState(false);
  const acContainerRef = useRef<HTMLDivElement>(null);

  const acMatches = useMemo(() => {
    const clean = peerId.replace(/\s+/g, '').toLowerCase();
    if (!clean || activeMode !== 'id' || isConnecting || isLive) return [];
    return devices
      .filter((d) => {
        if (d.mode !== 'id') return false;
        const id = (d.peerId ?? '').replace(/\s+/g, '').toLowerCase();
        if (id === clean) return false;
        return (
          id.includes(clean) ||
          (d.alias ?? '').toLowerCase().includes(clean) ||
          (d.hostname ?? '').toLowerCase().includes(clean)
        );
      })
      .slice(0, 5);
  }, [devices, peerId, activeMode, isConnecting, isLive]);

  const showAutocomplete = acOpen && acMatches.length > 0;

  useEffect(() => {
    if (!showAutocomplete) return;
    const onPointerDown = (event: PointerEvent) => {
      if (acContainerRef.current && !acContainerRef.current.contains(event.target as Node)) {
        setAcOpen(false);
        setAcIndex(-1);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [showAutocomplete]);

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
                  setAcOpen(false);
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
                  setAcOpen(false);
                  onChangeMode('direct');
                }}
              >
                {t(locale, 'modeDirect')}
              </button>
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            if (showAutocomplete && acIndex >= 0 && acMatches[acIndex]) {
              e.preventDefault();
              const chosen = acMatches[acIndex];
              setAcOpen(false);
              setAcIndex(-1);
              handleDeviceRowTap(chosen);
              return;
            }
            setAcOpen(false);
            handleHeroSubmit(e);
          }}
          noValidate
        >
          {activeMode === 'id' ? (
            <div ref={acContainerRef} className="relative">
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
                    aria-expanded={showAutocomplete || undefined}
                    aria-autocomplete="list"
                    className={`rd-hero-input font-mono-tabular${peerId ? ' has-value' : ''}`}
                    value={formattedIdValue}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t(locale, 'remoteIdLabel')}
                    onFocus={(e) => {
                      e.currentTarget.select();
                      setAcOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (!showAutocomplete) return;
                      if (e.key === 'ArrowDown') {
                        e.preventDefault();
                        setAcIndex((prev) => (prev + 1) % acMatches.length);
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault();
                        setAcIndex((prev) => (prev <= 0 ? acMatches.length - 1 : prev - 1));
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setAcOpen(false);
                        setAcIndex(-1);
                      }
                    }}
                    onChange={(e) => {
                      setAcOpen(true);
                      setAcIndex(-1);
                      handleIdInputChange(e.target.value);
                    }}
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
                      setAcOpen(false);
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

              {showAutocomplete && (
                <ul
                  className="rd-autocomplete"
                  role="listbox"
                  data-testid="peer-autocomplete"
                >
                  {acMatches.map((device, index) => {
                    const idText = formatPeerId(device.peerId ?? '');
                    const label = device.alias || device.hostname || idText;
                    const hasPw = Boolean(savedPasswords[device.key]);
                    return (
                      <li key={device.key} role="option" aria-selected={index === acIndex}>
                        <button
                          type="button"
                          className={`rd-autocomplete-item${index === acIndex ? ' active' : ''}`}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => {
                            setAcOpen(false);
                            setAcIndex(-1);
                            handleDeviceRowTap(device);
                          }}
                        >
                          <span className="w-7 h-7 rounded-lg bg-[var(--rd-icon-tile-bg)] text-[var(--accent)] inline-flex items-center justify-center shrink-0">
                            <PlatformIcon platform={device.platform} size={15} />
                          </span>
                          <span className="min-w-0 flex-1 text-left">
                            <span className="block text-[13px] font-medium text-[var(--ink)] truncate">
                              {label}
                            </span>
                            <span className="block text-xs font-mono-tabular text-[var(--rd-id-ink)] truncate">
                              {idText}
                            </span>
                          </span>
                          {hasPw && (
                            <KeyRound
                              size={13}
                              className="text-[var(--ok)] shrink-0"
                              aria-label={t(locale, 'savedPasswordIndicator')}
                            />
                          )}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
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
                  onFocus={(e) => e.currentTarget.select()}
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
              onClick={isLive ? () => setConfirmDisconnectOpen(true) : onDisconnect}
            >
              {isLive ? t(locale, 'disconnect') : t(locale, 'cancel')}
            </button>
          </div>
        )}
        <ConfirmDialog
          open={confirmDisconnectOpen}
          locale={locale}
          title={t(locale, 'disconnectRemote')}
          description={t(locale, 'confirmDisconnect')}
          confirmLabel={t(locale, 'disconnect')}
          onClose={() => setConfirmDisconnectOpen(false)}
          onConfirm={onDisconnect}
        />

        {!isLive && !isConnecting && (phase === 'error' || decoderError) && (
          <ErrorBanner
            locale={locale}
            rawError={decoderError || detail}
            error={connectionError}
            autoReconnect={model.autoReconnect}
            onCancelAutoReconnect={model.onCancelAutoReconnect}
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
