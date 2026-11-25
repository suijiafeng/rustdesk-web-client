// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useState } from 'react';
import { t, type Locale } from '../lib/i18n.ts';
import { validateChatText } from '../lib/platform.ts';

interface ChatLine {
  direction: 'in' | 'out';
  text: string;
}

interface ChatPanelProps {
  locale: Locale;
  open: boolean;
  lines: readonly ChatLine[];
  onSend: (text: string) => void;
  onClose: () => void;
}

export function ChatPanel({ locale, open, lines, onSend, onClose }: ChatPanelProps) {
  const [draft, setDraft] = useState('');
  if (!open) return null;
  return (
    <form
      className="rd-clipboard-panel"
      data-testid="chat-panel"
      onPointerDown={(event) => event.stopPropagation()}
      onSubmit={(event) => {
        event.preventDefault();
        if (validateChatText(draft) !== 'ok') return;
        onSend(draft.trim());
        setDraft('');
      }}
    >
      <div className="rd-clipboard-title">{t(locale, 'chat')}</div>
      <div className="rd-chat-log" data-testid="chat-log">
        {lines.map((line, index) => (
          <p key={`${index}-${line.direction}`} data-direction={line.direction}>{line.text}</p>
        ))}
      </div>
      <textarea
        value={draft}
        aria-label={t(locale, 'chatPlaceholder')}
        placeholder={t(locale, 'chatPlaceholder')}
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="rd-clipboard-actions">
        <button type="submit">{t(locale, 'send')}</button>
        <button type="button" onClick={onClose}>{t(locale, 'close')}</button>
      </div>
    </form>
  );
}
