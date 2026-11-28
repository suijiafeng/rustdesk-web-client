import React, { useId, useState } from 'react';
import { Eye, EyeOff, X } from 'lucide-react';
import { t, type Locale } from '../lib/i18n';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface PasswordModalProps {
  locale: Locale;
  targetLabel: string;
  password: string;
  rememberPassword: boolean;
  hasSavedPassword: boolean;
  gatewayToken: string;
  authRequired: boolean;
  isConnecting: boolean;
  onChangePassword: (value: string) => void;
  onChangeRememberPassword: (checked: boolean) => void;
  onClearSavedPassword: () => void;
  onChangeGatewayToken: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClose: () => void;
}

export function PasswordModal({
  locale,
  targetLabel,
  password,
  rememberPassword,
  hasSavedPassword,
  gatewayToken,
  authRequired,
  isConnecting,
  onChangePassword,
  onChangeRememberPassword,
  onClearSavedPassword,
  onChangeGatewayToken,
  onSubmit,
  onClose,
}: PasswordModalProps) {
  const titleId = useId();
  const dialogRef = useDialogFocus(onClose);
  const [showPassword, setShowPassword] = useState(false);

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
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="rd-password-dialog"
        data-testid="password-modal"
        onSubmit={onSubmit}
      >
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <h2 id={titleId} className="text-base font-semibold text-[var(--ink)] m-0">
            {t(locale, 'passwordPromptTitle')}
          </h2>
          <button
            type="button"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg border-0 bg-transparent text-[var(--ink-soft)] hover:bg-[var(--rd-hover-bg)]"
            aria-label={t(locale, 'close')}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>

        <p className="mt-0 mb-3 text-xs text-[var(--ink-soft)]">
          {t(locale, 'passwordPromptSubtitle')}{' '}
          <span className="font-mono-tabular font-semibold text-[var(--ink)]">{targetLabel}</span>
        </p>

        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-[var(--ink-soft)]">
            <span className="flex items-center justify-between gap-2">
              <span>{t(locale, 'password')}</span>
              {hasSavedPassword && (
                <button
                  type="button"
                  className="text-[11px] font-medium text-[var(--accent)] hover:underline border-0 bg-transparent p-0 cursor-pointer"
                  data-testid="clear-saved-password"
                  onClick={onClearSavedPassword}
                >
                  {t(locale, 'clearSavedPassword')}
                </button>
              )}
            </span>
            <div className="rd-password-input-wrap">
              <input
                type={showPassword ? 'text' : 'password'}
                className="rd-input rd-password-input"
                data-testid="password"
                value={password}
                autoFocus
                autoComplete="current-password"
                placeholder={t(locale, 'passwordPlaceholder')}
                onChange={(e) => onChangePassword(e.target.value)}
              />
              <button
                type="button"
                className="rd-password-eye-btn"
                data-testid="password-toggle-visibility"
                aria-label={t(locale, showPassword ? 'hidePasswordAria' : 'showPasswordAria')}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((prev) => !prev)}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          <label className="rd-check-row !py-0.5 text-xs">
            <input
              type="checkbox"
              data-testid="remember-password"
              checked={rememberPassword}
              onChange={(e) => onChangeRememberPassword(e.target.checked)}
            />
            <span>{t(locale, 'rememberPassword')}</span>
          </label>

          {authRequired && (
            <label className="flex flex-col gap-1 text-xs font-medium text-[var(--ink-soft)]">
              <span>{t(locale, 'gatewayToken')}</span>
              <input
                type="password"
                className="rd-input"
                data-testid="gateway-token"
                value={gatewayToken}
                autoComplete="off"
                placeholder={t(locale, 'gatewayTokenPlaceholder')}
                onChange={(e) => onChangeGatewayToken(e.target.value)}
              />
            </label>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 mt-4">
          <button
            type="button"
            className="rd-btn"
            style={{ minHeight: 44 }}
            onClick={onClose}
          >
            {t(locale, 'cancel')}
          </button>
          <button
            type="submit"
            className="rd-btn primary flex-1"
            style={{ minHeight: 44 }}
            data-testid="password-confirm-connect"
            disabled={isConnecting}
          >
            {isConnecting ? t(locale, 'connecting') : t(locale, 'confirmConnect')}
          </button>
        </div>
      </form>
    </div>
  );
}
