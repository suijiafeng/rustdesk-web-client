// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useEffect, useState } from 'react';
import { t, type Locale } from '../lib/i18n.ts';
import { validateClipboardText } from '../lib/platform.ts';

interface ClipboardPanelProps {
  locale: Locale;
  open: boolean;
  incoming: string | null;
  permitted: boolean;
  disabled: boolean;
  onSend: (text: string) => 'ok' | 'disabled' | 'denied' | 'empty' | 'too-large';
  onClose: () => void;
}

export function ClipboardPanel({ locale, open, incoming, permitted, disabled, onSend, onClose }: ClipboardPanelProps) {
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => {
    if (incoming) setNote(t(locale, 'copyRemoteText'));
  }, [incoming, locale]);
  if (!open || disabled) return null;
  return (
    <form
      className="rd-clipboard-panel"
      data-testid="clipboard-panel"
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        const decision = onSend(draft);
        setNote(t(locale, decision === 'ok' ? 'clipSent' : decision === 'denied' ? 'clipDenied' : 'clipInvalid'));
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
              void navigator.clipboard?.writeText(incoming).then(
                () => setNote(t(locale, 'clipCopied')),
                () => setNote(t(locale, 'clipDenied')),
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
        <button type="button" onClick={onClose}>{t(locale, 'close')}</button>
      </div>
      {note ? <p>{note}</p> : null}
    </form>
  );
}
