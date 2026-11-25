// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useState } from 'react';
import { t, type I18nKey, type Locale } from '../lib/i18n.ts';
import { validateClipboardText, type ClipboardActionResult } from '../lib/platform.ts';
import { useToast } from './ToastProvider.tsx';

interface ClipboardPanelProps {
  locale: Locale;
  open: boolean;
  incoming: string | null;
  permitted: boolean;
  disabled: boolean;
  viewOnly: boolean;
  onSend: (text: string) => ClipboardActionResult;
  onPasteLocalClipboard: () => Promise<ClipboardActionResult>;
  sync: boolean;
  syncNeedsRead: boolean;
  onToggleSync: () => void;
  onSyncNow: () => Promise<ClipboardActionResult>;
  onCopied: (text: string) => void;
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

export function ClipboardPanel({ locale, open, incoming, permitted, disabled, viewOnly, onSend, onPasteLocalClipboard,
  sync, syncNeedsRead, onToggleSync, onSyncNow, onCopied, onClose }: ClipboardPanelProps) {
  const [draft, setDraft] = useState('');
  const [pasting, setPasting] = useState(false);
  const showToast = useToast();
  if (!open || disabled) return null;

  function reportClipboardResult(result: ClipboardActionResult, successLabel: I18nKey) {
    if (result === 'ok') showToast(t(locale, successLabel));
    else showToast(t(locale, clipboardNotice[result]), 'error');
  }

  const readLocal = async (send: () => Promise<ClipboardActionResult>, success: I18nKey) => {
    setPasting(true);
    try {
      reportClipboardResult(await send(), success);
    } catch {
      reportClipboardResult('disconnected', success);
    } finally {
      setPasting(false);
    }
  };

  async function copyRemoteText(text: string) {
    const validation = validateClipboardText(text, false, permitted);
    if (validation !== 'ok') {
      reportClipboardResult(validation, 'clipCopied');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      onCopied(text);
      showToast(t(locale, 'clipCopied'));
    } catch {
      showToast(t(locale, 'clipDenied'), 'error');
    }
  }

  return (
    <form
      className="rd-clipboard-panel"
      data-testid="clipboard-panel"
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        const decision = onSend(draft);
        reportClipboardResult(decision, 'clipSent');
        if (decision === 'ok') setDraft('');
      }}
    >
      <div className="rd-clipboard-title">{t(locale, 'clipboard')}</div>
      <label className="inline-flex items-center gap-2">
        <input type="checkbox" role="switch" checked={sync} disabled={!permitted} onChange={onToggleSync} />
        {t(locale, 'clipSync')}
      </label>
      {syncNeedsRead ? <p>{t(locale, 'clipSyncPrompt')}</p> : null}
      {incoming ? (
        <>
          <textarea readOnly value={incoming} aria-label={t(locale, 'copyRemoteText')} />
          <button type="button" onClick={() => void copyRemoteText(incoming)}>
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
        <button type="button" disabled={!permitted || viewOnly || pasting} onClick={() => void readLocal(onPasteLocalClipboard, 'clipInputSent')}>
          {t(locale, 'clipTypeLocal')}
        </button>
        {sync ? (
          <button type="button" disabled={pasting || !permitted} onClick={() => void readLocal(onSyncNow, 'clipSent')}>
            {t(locale, 'clipSyncNow')}
          </button>
        ) : null}
        <button type="button" onClick={onClose}>{t(locale, 'close')}</button>
      </div>
    </form>
  );
}
