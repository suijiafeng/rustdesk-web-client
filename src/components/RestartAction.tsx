import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { RotateCcw, X } from 'lucide-react';
import { t, type Locale } from '../lib/i18n';

export function RestartAction({ locale, className, onConfirm }: {
  locale: Locale;
  className: string;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  useLayoutEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      trigger.current?.focus({ preventScroll: true });
    };
  }, [open]);

  return <>
    <button ref={trigger} type="button" className={className} onClick={() => setOpen(true)}>
      <RotateCcw /><span>{t(locale, 'restartDevice')}</span>
    </button>
    {open && createPortal(<dialog ref={dialog} className="session-confirm" data-session-confirm
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`}
      onCancel={event => { event.preventDefault(); setOpen(false); }}
      onPointerDown={event => event.stopPropagation()}
      onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) setOpen(false); }}>
      <div className="session-confirm-content">
        <header><h2 id={`${id}-title`}>{t(locale, 'restartDevice')}</h2>
          <button type="button" className="dialog-close" aria-label={t(locale, 'close')} onClick={() => setOpen(false)}><X size={18} /></button>
        </header>
        <p id={`${id}-description`}>{t(locale, 'confirmRestart')}</p>
        <footer>
          <button type="button" className="rd-btn" autoFocus onClick={() => setOpen(false)}>{t(locale, 'cancel')}</button>
          <button type="button" className="rd-btn danger" onClick={() => { setOpen(false); onConfirm(); }}>{t(locale, 'restartDevice')}</button>
        </footer>
      </div>
    </dialog>, document.body)}
  </>;
}
