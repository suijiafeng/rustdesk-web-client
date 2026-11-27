import { RefreshCw, X } from 'lucide-react';
import { t, type Locale } from '../lib/i18n';
import { applyPwaUpdate, dismissPwaUpdate, usePwaState } from '../lib/pwa';

interface PwaUpdateToastProps {
  locale: Locale;
  hidden?: boolean;
}

export function PwaUpdateToast({ locale, hidden = false }: PwaUpdateToastProps) {
  const { updateAvailable, updateDismissed } = usePwaState();

  if (hidden || !updateAvailable || updateDismissed) return null;

  return (
    <div
      className="fixed bottom-4 right-4 z-[60] flex items-center gap-2.5 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3.5 py-2.5 text-[var(--ink)] shadow-lg"
      role="status"
      aria-live="polite"
      data-testid="pwa-update-toast"
    >
      <RefreshCw size={15} className="shrink-0 text-[var(--accent)]" aria-hidden="true" />
      <span className="text-xs font-medium">{t(locale, 'pwaUpdateAvailable')}</span>
      <button
        type="button"
        className="rd-btn primary !h-7 !px-2.5 !text-xs"
        data-testid="pwa-update-apply"
        onClick={applyPwaUpdate}
      >
        {t(locale, 'pwaUpdateNow')}
      </button>
      <button
        type="button"
        className="inline-flex h-6 w-6 items-center justify-center rounded-md text-[var(--ink-soft)] hover:bg-[var(--rd-hover-bg)] hover:text-[var(--ink)]"
        aria-label={t(locale, 'close')}
        onClick={dismissPwaUpdate}
      >
        <X size={14} />
      </button>
    </div>
  );
}
