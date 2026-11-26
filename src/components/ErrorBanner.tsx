import type { ErrorPayload } from '../../shared/errors';
import { AlertCircle, KeyRound, RotateCw, Settings, X } from 'lucide-react';
import { formatConnectionError } from '../lib/errors';
import { t, type Locale } from '../lib/i18n';

interface ErrorBannerProps {
  locale: Locale;
  rawError: string;
  error?: ErrorPayload;
  onDismiss: () => void;
  onRetry?: () => void;
  onOpenNetworkSettings?: () => void;
  onRetryPassword?: () => void;
}

export function ErrorBanner({
  locale,
  rawError,
  error,
  onDismiss,
  onRetry,
  onOpenNetworkSettings,
  onRetryPassword,
}: ErrorBannerProps) {
  const formatted = formatConnectionError(locale, error ?? rawError);

  const technicalDetail = error?.detail ?? rawError;
  const repeatedSummary = error && ['PASSWORD_INVALID', 'PASSWORD_REQUIRED', 'GATEWAY_TOKEN_INVALID', 'RATE_LIMITED', 'PEER_NOT_FOUND', 'PEER_OFFLINE', 'TWO_FACTOR_REQUIRED'].includes(error.code) && !technicalDetail.includes('[stage=');
  const showRawDetail = Boolean(technicalDetail.trim() && technicalDetail.trim() !== formatted.message && !repeatedSummary);
  return (
    <div className="rd-err-banner" data-testid="error-banner" role="alert">
      <AlertCircle size={17} className="text-[var(--bad)] shrink-0 mt-0.5" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-[var(--bad)] leading-snug" data-testid="error-title">
          {formatted.title}
        </div>
        <p
          className="m-0 mt-0.5 text-xs text-[var(--ink)] leading-relaxed break-words"
          data-testid="detail"
        >
          {formatted.message}
        </p>

        {onRetry || (formatted.kind === 'network' && onOpenNetworkSettings) ||
        (formatted.kind === 'auth' && onRetryPassword) ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {onRetry && formatted.kind !== 'auth' && (
              <button type="button" className="rd-err-action-btn" data-testid="error-action-retry" onClick={onRetry}>
                <RotateCw size={13} />
                <span>{t(locale, 'actionRetryConnection')}</span>
              </button>
            )}
            {formatted.kind === 'network' && onOpenNetworkSettings && (
              <button
                type="button"
                className="rd-err-action-btn"
                data-testid="error-action-network"
                onClick={onOpenNetworkSettings}
              >
                <Settings size={13} />
                <span>{t(locale, 'actionNetworkSettings')}</span>
              </button>
            )}
            {formatted.kind === 'auth' && onRetryPassword && (
              <button
                type="button"
                className="rd-err-action-btn"
                data-testid="error-action-password"
                onClick={onRetryPassword}
              >
                <KeyRound size={13} />
                <span>{t(locale, 'actionRetryPassword')}</span>
              </button>
            )}
          </div>
        ) : null}
        {(error || showRawDetail) && (
          <details className="mt-2 text-xs text-[var(--ink-soft)]" data-testid="error-technical-details">
            <summary className="cursor-pointer">{t(locale, 'technicalDetails')}</summary>
            {error && <p className="m-0 mt-1 break-words font-mono">{error.code} · {error.stage}</p>}
            {showRawDetail && <p className="m-0 mt-1 break-words whitespace-pre-wrap">{technicalDetail}</p>}
          </details>
        )}
      </div>

      <button
        type="button"
        className="rd-err-dismiss-btn"
        data-testid="error-dismiss"
        aria-label={t(locale, 'dismissError')}
        data-tooltip={t(locale, 'dismissError')}
        data-tooltip-pos="top-end"
        onClick={onDismiss}
      >
        <X size={15} />
      </button>
    </div>
  );
}
