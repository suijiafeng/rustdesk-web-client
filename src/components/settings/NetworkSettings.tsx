import React, { useState } from 'react';
import { ChevronRight, Globe, KeyRound, Network, Server } from 'lucide-react';
import { t, type Locale } from '../../lib/i18n';

export function NetworkSettings({
  locale,
  idServer,
  relayServer = '',
  serverKey = '',
  forceRelay = false,
  directIpEnabled,
  webRtcOptIn,
  gatewayToken,
  gatewayTokenReadFailed,
  onSaveGatewayToken,
  onOpenServerDialog,
  onToggleDirectIp,
  onChangeWebRtcOptIn,
}: {
  locale: Locale;
  idServer: string;
  relayServer?: string;
  serverKey?: string;
  forceRelay?: boolean;
  directIpEnabled: boolean;
  webRtcOptIn: boolean;
  gatewayToken: string;
  gatewayTokenReadFailed: boolean;
  onSaveGatewayToken: (value: string) => Promise<boolean>;
  onOpenServerDialog: () => void;
  onToggleDirectIp: () => void;
  onChangeWebRtcOptIn: (checked: boolean) => void;
}) {
  const [editingToken, setEditingToken] = useState(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [tokenSaveFailed, setTokenSaveFailed] = useState(false);

  const trimmedIdServer = idServer.trim();
  const serverTags: string[] = [];
  if (relayServer.trim()) serverTags.push(t(locale, 'serverSummaryRelay'));
  if (serverKey.trim()) serverTags.push(t(locale, 'serverSummaryKey'));
  if (forceRelay) serverTags.push(t(locale, 'serverSummaryForceRelay'));

  async function saveToken(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (savingToken) return;
    setSavingToken(true);
    try {
      const saved = await onSaveGatewayToken(tokenDraft);
      setTokenSaveFailed(!saved);
      if (saved) setEditingToken(false);
    } finally {
      setSavingToken(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <section className="rd-settings-card">
        <h3 className="rd-settings-card-title">{t(locale, 'networkServerSectionTitle')}</h3>

        <button
          type="button"
          className="rd-network-action-row"
          data-testid="open-id-server-dialog"
          onClick={onOpenServerDialog}
        >
          <Server size={18} className="text-[var(--accent)] shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1 text-left">
            <div className="text-[15px] text-[var(--ink)]">
              {t(locale, 'idRelayServerTitle')}
            </div>
            {trimmedIdServer ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5">
                <span className="text-xs text-[var(--ink-soft)] truncate font-mono-tabular max-w-full">
                  {trimmedIdServer}
                </span>
                {serverTags.map((tag) => (
                  <span key={tag} className="rd-tag-chip">
                    {tag}
                  </span>
                ))}
              </div>
            ) : (
              <div className="text-xs text-[var(--warn)] mt-0.5">
                {t(locale, 'serverConfigureHint')}
              </div>
            )}
          </div>
          <ChevronRight size={16} className="text-[var(--ink-soft)] shrink-0" aria-hidden="true" />
        </button>

        <div className="settings-option-row">
          <div className="flex items-center gap-2.5 min-w-0 grow">
            <KeyRound size={17} className="text-[var(--accent)] shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-[15px] text-[var(--ink)]">{t(locale, 'gatewayToken')}</div>
              <div
                className={`text-xs mt-0.5 ${
                  gatewayTokenReadFailed
                    ? 'text-[var(--bad)]'
                    : gatewayToken
                      ? 'text-[var(--ok)]'
                      : 'text-[var(--ink-soft)]'
                }`}
              >
                {t(
                  locale,
                  gatewayTokenReadFailed
                    ? 'gatewayTokenReadFailed'
                    : gatewayToken
                      ? 'gatewayTokenConfigured'
                      : 'gatewayTokenNotConfigured',
                )}
              </div>
            </div>
          </div>
          {!editingToken && (
            <button
              type="button"
              className="rd-btn shrink-0"
              data-testid="settings-gateway-token-edit"
              onClick={() => {
                setTokenDraft(gatewayToken);
                setTokenSaveFailed(false);
                setEditingToken(true);
              }}
            >
              {t(locale, gatewayToken ? 'gatewayTokenChange' : 'gatewayTokenSet')}
            </button>
          )}
        </div>

        {editingToken && (
          <form className="flex flex-col gap-2 pt-2 pb-1" onSubmit={saveToken}>
            <input
              type="password"
              className="rd-input"
              data-testid="settings-gateway-token"
              value={tokenDraft}
              disabled={savingToken}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              aria-label={t(locale, 'gatewayToken')}
              placeholder={t(locale, 'gatewayTokenPlaceholder')}
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setEditingToken(false);
                }
              }}
              onChange={(event) => setTokenDraft(event.target.value)}
            />
            <p className="text-xs text-[var(--ink-soft)] m-0">{t(locale, 'gatewayTokenClearHint')}</p>
            {tokenSaveFailed && (
              <p role="alert" className="text-xs text-[var(--bad)] m-0">
                {t(locale, 'gatewayTokenSaveFailed')}
              </p>
            )}
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rd-btn"
                disabled={savingToken}
                onClick={() => setEditingToken(false)}
              >
                {t(locale, 'cancel')}
              </button>
              <button
                type="submit"
                className="rd-btn primary"
                data-testid="settings-gateway-token-save"
                disabled={savingToken}
              >
                {t(locale, 'gatewayTokenSave')}
              </button>
            </div>
          </form>
        )}
      </section>

      <section className="rd-settings-card">
        <h3 className="rd-settings-card-title">{t(locale, 'networkTransportSectionTitle')}</h3>

        <label className="settings-option-row">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <Network size={17} className="text-[var(--accent)] shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-[15px] text-[var(--ink)]">{t(locale, 'enableDirectIpLabel')}</div>
              <div className="text-xs text-[var(--ink-soft)] mt-0.5">{t(locale, 'enableDirectIpHint')}</div>
            </div>
          </div>
          <input
            type="checkbox"
            role="switch"
            className="ui-switch"
            checked={directIpEnabled}
            data-testid="settings-toggle-direct-ip"
            onChange={onToggleDirectIp}
          />
        </label>

        <label className="settings-option-row">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <Globe size={17} className="text-[var(--accent)] shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-[15px] text-[var(--ink)]">{t(locale, 'enableWebRtcLabel')}</div>
              <div className="text-xs text-[var(--ink-soft)] mt-0.5">{t(locale, 'enableWebRtcHint')}</div>
            </div>
          </div>
          <input
            type="checkbox"
            role="switch"
            className="ui-switch"
            checked={webRtcOptIn}
            data-testid="settings-toggle-webrtc"
            onChange={(event) => onChangeWebRtcOptIn(event.target.checked)}
          />
        </label>
      </section>
    </div>
  );
}


