import React, { useState } from 'react';
import { ChevronRight, KeyRound, Network, Server } from 'lucide-react';
import { t, type Locale } from '../../lib/i18n';

export function NetworkSettings({
  locale,
  idServer,
  directIpEnabled,
  gatewayToken,
  gatewayTokenReadFailed,
  onSaveGatewayToken,
  onOpenServerDialog,
  onToggleDirectIp,
}: {
  locale: Locale;
  idServer: string;
  directIpEnabled: boolean;
  gatewayToken: string;
  gatewayTokenReadFailed: boolean;
  onSaveGatewayToken: (value: string) => Promise<boolean>;
  onOpenServerDialog: () => void;
  onToggleDirectIp: () => void;
}) {
  const [editingToken, setEditingToken] = useState(false);
  const [tokenDraft, setTokenDraft] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [tokenSaveFailed, setTokenSaveFailed] = useState(false);

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
    <div className="flex flex-col gap-4">
      <section className="rd-settings-card">
        <h2 className="rd-settings-card-title">{t(locale, 'settingsNetwork')}</h2>

        <button
          type="button"
          className="rd-network-action-row"
          data-testid="open-id-server-dialog"
          onClick={onOpenServerDialog}
        >
          <Server size={18} className="text-[var(--accent)] shrink-0" />
          <div className="min-w-0 flex-1 text-left">
            <div className="text-sm font-medium text-[var(--ink)]">
              {t(locale, 'idRelayServerTitle')}
            </div>
            {idServer.trim() && (
              <div className="text-xs text-[var(--ink-soft)] truncate font-mono-tabular mt-0.5">
                {idServer.trim()}
              </div>
            )}
          </div>
          <ChevronRight size={16} className="text-[var(--ink-soft)] shrink-0" />
        </button>

        <div className="my-2.5 h-px bg-[var(--rd-divider)]" />

        <label className="settings-option-row">
          <div className="flex items-center gap-2.5 min-w-0">
            <Network size={17} className="text-[var(--accent)] shrink-0" />
            <span className="text-sm font-medium text-[var(--ink)]">
              {t(locale, 'enableDirectIpLabel')}
            </span>
          </div>
          <input type="checkbox" role="switch" className="ui-switch" checked={directIpEnabled}
            data-testid="settings-toggle-direct-ip" onChange={onToggleDirectIp} />
        </label>

        <div className="settings-option-row">
          <div className="flex items-center gap-2.5 min-w-0 grow">
            <KeyRound size={17} className="text-[var(--accent)] shrink-0" aria-hidden="true" />
            <div className="min-w-0">
              <div className="text-sm font-medium">{t(locale, 'gatewayToken')}</div>
              <div className="text-xs text-[var(--ink-soft)]">
                {t(locale, gatewayTokenReadFailed ? 'gatewayTokenReadFailed' : gatewayToken ? 'gatewayTokenConfigured' : 'gatewayTokenNotConfigured')}
              </div>
            </div>
          </div>
          {!editingToken && (
            <button type="button" className="rd-btn shrink-0" data-testid="settings-gateway-token-edit"
              onClick={() => {
                setTokenDraft(gatewayToken);
                setTokenSaveFailed(false);
                setEditingToken(true);
              }}>
              {t(locale, gatewayToken ? 'gatewayTokenChange' : 'gatewayTokenSet')}
            </button>
          )}
        </div>

        {editingToken && (
          <form className="flex flex-col gap-2 pt-2" onSubmit={saveToken}>
            <input type="password" className="rd-input" data-testid="settings-gateway-token"
              value={tokenDraft} disabled={savingToken} autoFocus autoComplete="off" spellCheck={false}
              aria-label={t(locale, 'gatewayToken')} placeholder={t(locale, 'gatewayTokenPlaceholder')}
              onChange={event => setTokenDraft(event.target.value)} />
            <p className="text-xs text-[var(--ink-soft)]">{t(locale, 'gatewayTokenClearHint')}</p>
            {tokenSaveFailed && <p role="alert" className="text-xs text-[var(--bad)]">{t(locale, 'gatewayTokenSaveFailed')}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="rd-btn" disabled={savingToken} onClick={() => setEditingToken(false)}>
                {t(locale, 'cancel')}
              </button>
              <button type="submit" className="rd-btn primary" data-testid="settings-gateway-token-save" disabled={savingToken}>
                {t(locale, 'gatewayTokenSave')}
              </button>
            </div>
          </form>
        )}
      </section>
    </div>
  );
}

