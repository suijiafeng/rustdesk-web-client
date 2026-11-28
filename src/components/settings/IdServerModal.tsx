import { useId, useRef, useState } from 'react';
import { Server, X } from 'lucide-react';
import { t, type Locale } from '../../lib/i18n';
import { isValidServerPublicKey } from '../../../shared/serverKey';
import { useDialogFocus } from '../../hooks/useDialogFocus';

export type ServerField = 'idServer' | 'relayServer' | 'serverKey';

export interface ServerSettings {
  idServer: string;
  relayServer: string;
  serverKey: string;
  forceRelay: boolean;
}

interface IdServerModalProps extends ServerSettings {
  locale: Locale;
  connectionSetup?: boolean;
  onChangeField: (field: ServerField, value: string) => void;
  onChangeForceRelay: (checked: boolean) => void;
  onClose: () => void;
  onSave?: (settings: ServerSettings) => void;
}

export function IdServerModal({
  locale,
  idServer,
  relayServer,
  serverKey,
  forceRelay,
  connectionSetup = false,
  onChangeField,
  onChangeForceRelay,
  onClose,
  onSave,
}: IdServerModalProps) {
  const [draft, setDraft] = useState<ServerSettings>({ idServer, relayServer, serverKey, forceRelay });
  const [submitted, setSubmitted] = useState(false);
  const [idTouched, setIdTouched] = useState(false);
  const [keyTouched, setKeyTouched] = useState(false);
  const idInput = useRef<HTMLInputElement>(null);
  const keyInput = useRef<HTMLInputElement>(null);
  const dialogId = useId();
  const dialogRef = useDialogFocus(onClose);
  const keyInvalid = Boolean(draft.serverKey.trim()) && !isValidServerPublicKey(draft.serverKey);
  const showKeyError = (submitted || keyTouched) && keyInvalid;
  const showIdError = connectionSetup && (submitted || idTouched) && !draft.idServer.trim();

  return (
    <div
      className="rd-password-scrim"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <form
        ref={dialogRef}
        tabIndex={-1}
        className="rd-password-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${dialogId}-title`}
        data-testid="id-server-modal"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(true);
          if (connectionSetup && !draft.idServer.trim()) {
            idInput.current?.focus();
            return;
          }
          if (keyInvalid) {
            keyInput.current?.focus();
            return;
          }
          const settings = {
            ...draft,
            idServer: draft.idServer.trim(),
            relayServer: draft.relayServer.trim(),
            serverKey: draft.serverKey.trim(),
          };
          onChangeField('idServer', settings.idServer);
          onChangeField('relayServer', settings.relayServer);
          onChangeField('serverKey', settings.serverKey);
          onChangeForceRelay(settings.forceRelay);
          if (onSave) onSave(settings);
          else onClose();
        }}
      >
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Server size={17} className="text-[var(--accent)]" />
            <h2 id={`${dialogId}-title`} className="text-base font-semibold text-[var(--ink)] m-0">
              {t(locale, connectionSetup ? 'settingsNeededTitle' : 'idRelayServerTitle')}
            </h2>
          </div>
          <button
            type="button"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg border-0 bg-transparent text-[var(--ink-soft)] hover:bg-[var(--rd-hover-bg)]"
            aria-label={t(locale, 'close')}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--ink-soft)]">
            <span>{t(locale, 'idServer')}</span>
            <input
              ref={idInput}
              type="text"
              className={`rd-input font-mono-tabular${showIdError ? ' has-error' : ''}`}
              data-testid="id-server"
              aria-invalid={showIdError || undefined}
              aria-describedby={showIdError ? `${dialogId}-server-error` : undefined}
              value={draft.idServer}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              placeholder="hbbs.example.com:21116"
              onBlur={() => setIdTouched(true)}
              onChange={(e) => setDraft(previous => ({ ...previous, idServer: e.target.value }))}
            />
            {showIdError && <span id={`${dialogId}-server-error`} role="alert" className="text-[var(--bad)]">
              {t(locale, 'idServerRequired')}
            </span>}
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--ink-soft)]">
            <span>{t(locale, 'relayServer')}</span>
            <input
              type="text"
              className="rd-input font-mono-tabular"
              data-testid="relay-server"
              value={draft.relayServer}
              autoComplete="off"
              spellCheck={false}
              placeholder={t(locale, 'optional')}
              onChange={(e) => setDraft(previous => ({ ...previous, relayServer: e.target.value }))}
            />
          </label>

          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--ink-soft)]">
            <span>{t(locale, 'serverPublicKey')}</span>
            <input
              ref={keyInput}
              type="password"
              className={`rd-input font-mono-tabular${showKeyError ? ' has-error' : ''}`}
              data-testid="server-key"
              value={draft.serverKey}
              aria-invalid={showKeyError || undefined}
              aria-describedby={`${dialogId}-key-hint${showKeyError ? ` ${dialogId}-key-error` : ''}`}
              autoComplete="off"
              spellCheck={false}
              placeholder="id_ed25519.pub"
              onBlur={() => setKeyTouched(true)}
              onChange={(e) => setDraft(previous => ({ ...previous, serverKey: e.target.value }))}
            />
            <span id={`${dialogId}-key-hint`} className="font-normal">{t(locale, 'serverPublicKeyHint')}</span>
            {showKeyError && <span id={`${dialogId}-key-error`} role="alert" className="text-[var(--bad)]">
              {t(locale, 'serverPublicKeyInvalid')}
            </span>}
          </label>

          <label className="rd-check-row">
            <input
              type="checkbox"
              checked={draft.forceRelay}
              onChange={(e) => setDraft(previous => ({ ...previous, forceRelay: e.target.checked }))}
            />
            <span>{t(locale, 'forceRelay')}</span>
          </label>

        </div>

        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            className="rd-btn"
            style={{ minHeight: 42 }}
            onClick={onClose}
          >
            {t(locale, 'cancel')}
          </button>
          <button
            type="submit"
            className="rd-btn primary"
            style={{ minHeight: 42, minWidth: 88 }}
            data-testid="id-server-save"
          >
            {t(locale, 'confirmOk')}
          </button>
        </div>
      </form>
    </div>
  );
}
