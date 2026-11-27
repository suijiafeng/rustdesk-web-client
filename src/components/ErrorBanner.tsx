import type { ErrorPayload } from '../../shared/errors';
import type { AutoReconnectState } from '../hooks/useGatewaySession';
import { useEffect, useRef, useState } from 'react';
import { AlertCircle, KeyRound, RotateCw, X } from 'lucide-react';
import { formatConnectionError } from '../lib/errors';
import { t, type Locale } from '../lib/i18n';

interface ErrorBannerProps {
  locale: Locale;
  rawError: string;
  error?: ErrorPayload;
  autoReconnect?: AutoReconnectState | null;
  onCancelAutoReconnect?: () => void;
  onDismiss: () => void;
  onRetry?: () => void;
  onOpenNetworkSettings?: () => void;
  onRetryPassword?: () => void;
}

export function ErrorBanner({
  locale,
  rawError,
  error,
  autoReconnect,
  onCancelAutoReconnect,
  onDismiss,
  onRetry,
  onRetryPassword,
}: ErrorBannerProps) {
  const formatted = formatConnectionError(locale, error ?? rawError);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const infoRef = useRef<HTMLDivElement>(null);

  const technicalDetail = error?.detail ?? rawError;
  const repeatedSummary = error && ['PASSWORD_INVALID', 'PASSWORD_REQUIRED', 'GATEWAY_TOKEN_INVALID', 'RATE_LIMITED', 'PEER_NOT_FOUND', 'PEER_OFFLINE', 'TWO_FACTOR_REQUIRED'].includes(error.code) && !technicalDetail.includes('[stage=');
  const showRawDetail = Boolean(technicalDetail.trim() && technicalDetail.trim() !== formatted.message && !repeatedSummary);
  const hasDetails = Boolean(error || showRawDetail);

  useEffect(() => {
    setDetailsOpen(false);
  }, [rawError, error]);

  useEffect(() => {
    if (!detailsOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!infoRef.current?.contains(event.target as Node)) {
        setDetailsOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setDetailsOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [detailsOpen]);

  return (
    <div className="rd-err-banner" data-testid="error-banner" role="alert">
      {hasDetails ? (
        <div className="rd-err-info-wrap" ref={infoRef}>
          <button
            type="button"
            className="rd-err-info-btn"
            data-testid="error-info-toggle"
            aria-label={t(locale, 'technicalDetails')}
            aria-expanded={detailsOpen}
            onClick={() => setDetailsOpen((prev) => !prev)}
          >
            <AlertCircle size={17} aria-hidden="true" />
          </button>
          {detailsOpen && (
            <div className="rd-err-tooltip" role="tooltip" data-testid="error-technical-details">
              {error && <p className="m-0 break-words font-mono">{error.code} · {error.stage}</p>}
              {showRawDetail && (
                <p className={`m-0 break-words whitespace-pre-wrap${error ? ' mt-1' : ''}`}>{technicalDetail}</p>
              )}
            </div>
          )}
        </div>
      ) : (
        <AlertCircle size={17} className="text-[var(--bad)] shrink-0" aria-hidden="true" />
      )}

      <div className="min-w-0 flex-1">
        <div className="rd-err-row">
          <div className="text-[13px] font-semibold text-[var(--bad)] leading-snug truncate" data-testid="error-title">
            {formatted.title}
          </div>
          {onRetry && formatted.kind !== 'auth' && (
            <button
              type="button"
              className="rd-err-action-btn shrink-0"
              data-testid="error-action-retry"
              onClick={() => {
                onCancelAutoReconnect?.();
                onRetry();
              }}
            >
              <RotateCw size={13} />
              <span>{t(locale, 'actionRetryConnection')}</span>
            </button>
          )}
          {formatted.kind === 'auth' && onRetryPassword && (
            <button
              type="button"
              className="rd-err-action-btn shrink-0"
              data-testid="error-action-password"
              onClick={onRetryPassword}
            >
              <KeyRound size={13} />
              <span>{t(locale, 'actionRetryPassword')}</span>
            </button>
          )}
        </div>
        {autoReconnect && (
          <div className="mt-0.5 flex items-center gap-2 text-xs text-[var(--ink-soft)]" data-testid="auto-reconnect-status">
            <span className="font-mono-tabular">
              {locale === 'zh'
                ? `${autoReconnect.secondsLeft} 秒后自动重连 (${autoReconnect.attempt}/${autoReconnect.maxAttempts})`
                : `Reconnecting in ${autoReconnect.secondsLeft}s (${autoReconnect.attempt}/${autoReconnect.maxAttempts})`}
            </span>
            {onCancelAutoReconnect && (
              <button
                type="button"
                className="rd-err-action-btn"
                data-testid="auto-reconnect-cancel"
                onClick={onCancelAutoReconnect}
              >
                {t(locale, 'cancel')}
              </button>
            )}
          </div>
        )}
        {formatted.message && (
          <p
            className="m-0 mt-0.5 text-xs text-[var(--ink)] leading-relaxed break-words"
            data-testid="detail"
          >
            {formatted.message}
          </p>
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
