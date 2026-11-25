// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useEffect, useState } from 'react';
import { t, type I18nKey, type Locale } from '../lib/i18n.ts';
import { validateClipboardText, type ClipboardActionResult } from '../lib/platform.ts';

interface ClipboardPanelProps {
  locale: Locale;
  open: boolean;
  incoming: string | null;
  permitted: boolean;
  disabled: boolean;
  viewOnly: boolean;
  onSend: (text: string) => ClipboardActionResult;
  onPasteLocalClipboard: () => Promise<ClipboardActionResult>;
  onClose: () => void;
}

const clipboardNotice: Record<Exclude<ClipboardActionResult, 'ok'>, I18nKey> = {
  disabled: 'clipHostDenied',
  denied: 'clipHostDenied',
  empty: 'clipEmpty',
  'too-large': 'clipInvalid',
  disconnected: 'clipDisconnected',
  'read-failed': 'clipReadFailed',
  'view-only': 'viewOnlyLabel',
};

export function ClipboardPanel({ locale, open, incoming, permitted, disabled, viewOnly, onSend, onPasteLocalClipboard, onClose }: ClipboardPanelProps) {
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState<I18nKey | null>(null);
  const [pasting, setPasting] = useState(false);
  useEffect(() => {
    if (incoming) setNote('copyRemoteText');
  }, [incoming]);
  if (!open || disabled) return null;
  const pasteLocal = async () => {
    setPasting(true);
    setNote(null);
    try {
      const result = await onPasteLocalClipboard();
      setNote(result === 'ok' ? 'clipInputSent' : clipboardNotice[result]);
    } catch {
      setNote('clipDisconnected');
    } finally {
      setPasting(false);
    }
  };

  return (
    <form
      className="rd-clipboard-panel"
      data-testid="clipboard-panel"
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        const decision = onSend(draft);
        setNote(decision === 'ok' ? 'clipSent' : clipboardNotice[decision]);
        if (decision === 'ok') setDraft('');
      }}
    >
      <div className="rd-clipboard-title">{t(locale, 'clipboard')}</div>
      {incoming ? (
        <>
          <textarea readOnly value={incoming} aria-label={t(locale, 'copyRemoteText')} />
          <button
            type="button"
            onClick={() => {
              if (validateClipboardText(incoming, false, permitted) !== 'ok') return;
              if (!navigator.clipboard?.writeText) {
                setNote('clipDenied');
                return;
              }
              void navigator.clipboard.writeText(incoming).then(
                () => setNote('clipCopied'),
                () => setNote('clipDenied'),
              );
            }}
          >
            {t(locale, 'copy')}
          </button>
        </>
      ) : null}
      <textarea
        value={draft}
        aria-label={t(locale, 'clipboardPlaceholder')}
        placeholder={t(locale, 'clipboardPlaceholder')}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="rd-clipboard-actions">
        <button type="submit" disabled={!permitted}>{t(locale, 'send')}</button>
        <button type="button" disabled={!permitted || viewOnly || pasting} onClick={() => void pasteLocal()}>
          {t(locale, 'clipTypeLocal')}
        </button>
        <button type="button" onClick={onClose}>{t(locale, 'close')}</button>
      </div>
      <p role="status">{note ? t(locale, note) : null}</p>
    </form>
  );
}
