import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { formatPeerId, type SavedDevice } from '../lib/devices';
import { t, type Locale } from '../lib/i18n';

function formatPrimaryId(device: SavedDevice): string {
  return device.mode === 'id'
    ? formatPeerId(device.peerId ?? '')
    : `${device.host ?? ''}:${device.port ?? '21118'}`;
}

interface RenameDeviceDialogProps {
  locale: Locale;
  device: SavedDevice;
  onSave: (key: string, alias: string) => void;
  onClose: () => void;
}

export function RenameDeviceDialog({ locale, device, onSave, onClose }: RenameDeviceDialogProps) {
  const [draft, setDraft] = useState(device.alias || '');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();

  useLayoutEffect(() => {
    const el = dialogRef.current;
    el?.showModal();
    inputRef.current?.select();
    return () => el?.close();
  }, []);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    onSave(device.key, draft);
    onClose();
  };

  const handleBackdropClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    event.stopPropagation();
    if (event.target === event.currentTarget) onClose();
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className="session-confirm"
      data-session-confirm
      data-testid="device-rename-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={handleBackdropClick}
    >
      <form className="session-confirm-content" onSubmit={handleSubmit}>
        <header>
          <h2 id={titleId}>{t(locale, 'editAliasAction')}</h2>
          <button
            type="button"
            className="dialog-close"
            aria-label={t(locale, 'close')}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <div className="mt-3 mb-5">
          <div className="text-xs text-[var(--ink-soft)] mb-2 font-mono-tabular">
            {device.hostname || formatPrimaryId(device)}
          </div>
          <input
            ref={inputRef}
            type="text"
            className="rd-input"
            data-testid="device-rename-input"
            value={draft}
            placeholder={t(locale, 'editAliasPlaceholder')}
            maxLength={64}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        <footer>
          <button type="button" className="rd-btn" onClick={onClose}>
            {t(locale, 'cancel')}
          </button>
          <button type="submit" className="rd-btn primary" data-testid="device-rename-save">
            {t(locale, 'saveAction')}
          </button>
        </footer>
      </form>
    </dialog>,
    document.body,
  );
}

interface RemoveDeviceDialogProps {
  locale: Locale;
  device: SavedDevice;
  onConfirm: (key: string) => void;
  onClose: () => void;
}

export function RemoveDeviceDialog({ locale, device, onConfirm, onClose }: RemoveDeviceDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useLayoutEffect(() => {
    const el = dialogRef.current;
    el?.showModal();
    return () => el?.close();
  }, []);

  const handleConfirm = () => {
    onConfirm(device.key);
    onClose();
  };

  const handleBackdropClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    event.stopPropagation();
    if (event.target === event.currentTarget) onClose();
  };

  return createPortal(
    <dialog
      ref={dialogRef}
      className="session-confirm"
      data-session-confirm
      data-testid="device-remove-dialog"
      aria-labelledby={titleId}
      aria-describedby={descId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={handleBackdropClick}
    >
      <div className="session-confirm-content">
        <header>
          <h2 id={titleId}>{t(locale, 'confirmRemoveDeviceTitle')}</h2>
          <button
            type="button"
            className="dialog-close"
            aria-label={t(locale, 'close')}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </header>
        <p id={descId}>{t(locale, 'confirmRemoveDeviceBody')}</p>
        <footer>
          <button type="button" className="rd-btn" autoFocus onClick={onClose}>
            {t(locale, 'cancel')}
          </button>
          <button
            type="button"
            className="rd-btn danger"
            data-testid="device-remove-confirm"
            onClick={handleConfirm}
          >
            {t(locale, 'removeDevice')}
          </button>
        </footer>
      </div>
    </dialog>,
    document.body,
  );
}
