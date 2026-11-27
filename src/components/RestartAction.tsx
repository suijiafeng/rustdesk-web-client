import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, X } from 'lucide-react';
import { t, type Locale } from '../lib/i18n';

export function ConfirmDialog({
  open,
  locale,
  title,
  description,
  confirmLabel,
  danger = true,
  onClose,
  onConfirm,
}: {
  open: boolean;
  locale: Locale;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <dialog
      ref={dialog}
      className="session-confirm"
      data-session-confirm
      data-testid="confirm-action-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => { event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="session-confirm-content">
        <header>
          <h2 id={`${id}-title`}>{title}</h2>
          <button
            type="button"
            className="dialog-close"
            aria-label={t(locale, 'close')}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <p id={`${id}-description`}>{description}</p>
        <footer>
          <button type="button" className="rd-btn" autoFocus onClick={onClose}>
            {t(locale, 'cancel')}
          </button>
          <button
            type="button"
            className={`rd-btn${danger ? ' danger' : ' primary'}`}
            data-testid="confirm-action-submit"
            onClick={() => { onClose(); onConfirm(); }}
          >
            {confirmLabel}
          </button>
        </footer>
      </div>
    </dialog>,
    document.body,
  );
}

export function RestartAction({ locale, className, onConfirm }: {
  locale: Locale;
  className: string;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={trigger} type="button" className={className} onClick={() => setOpen(true)}>
        <RotateCcw /><span>{t(locale, 'restartDevice')}</span>
      </button>
      <ConfirmDialog
        open={open}
        locale={locale}
        title={t(locale, 'restartDevice')}
        description={t(locale, 'confirmRestart')}
        confirmLabel={t(locale, 'restartDevice')}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus({ preventScroll: true });
        }}
        onConfirm={onConfirm}
      />
    </>
  );
}
