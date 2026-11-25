// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useEffect, useRef, useState, type RefObject } from 'react';
import type { ClientMessage } from '@rustdesk-web/shared';
import { ChevronDown } from 'lucide-react';
import { textMessages } from '../lib/keyboard.ts';
import type { ClipboardActionResult } from '../lib/platform.ts';
import { keyboardInset } from '../lib/gestures.ts';
import { t, type I18nKey, type Locale } from '../lib/i18n.ts';
import { controlFromKeyOrCode, isImeEvent } from '../lib/keys.ts';
import { softControlMessages, softTextEdit, toggleLatched } from '../lib/softKeyboard.ts';
import { useToast } from './ToastProvider.tsx';

interface SoftKeyboardBarProps {
  locale: Locale;
  inputRef: RefObject<HTMLInputElement | null>;
  viewOnly: boolean;
  onSend: (messages: ClientMessage[]) => void;
  onHide: () => void;
  onSyncPaste?: (text: string) => ClipboardActionResult;
}

const STICKY_MODIFIERS = [
  { label: 'Ctrl', control: 'Control' },
  { label: 'Alt', control: 'Alt' },
  { label: 'Shift', control: 'Shift' },
  { label: 'Win', control: 'Meta' },
] as const;

const EXTRA_KEYS: Array<{ label: string; control: string; labelKey?: I18nKey; ariaKey?: I18nKey }> = [
  { label: 'Esc', control: 'Escape' },
  { label: 'Tab', control: 'Tab' },
  { label: '←', control: 'ArrowLeft', ariaKey: 'arrowLeft' },
  { label: '↑', control: 'ArrowUp', ariaKey: 'arrowUp' },
  { label: '↓', control: 'ArrowDown', ariaKey: 'arrowDown' },
  { label: '→', control: 'ArrowRight', ariaKey: 'arrowRight' },
  { label: 'Home', control: 'Home', labelKey: 'keyHome' },
  { label: 'End', control: 'End', labelKey: 'keyEnd' },
  { label: 'Page Up', control: 'PageUp', labelKey: 'pageUp' },
  { label: 'Page Down', control: 'PageDown', labelKey: 'pageDown' },
  { label: 'Del', control: 'Delete', labelKey: 'keyDelete' },
  ...Array.from({ length: 12 }, (_, index) => {
    const name = `F${index + 1}`;
    return { label: name, control: name };
  }),
];

export function SoftKeyboardBar({ locale, inputRef, viewOnly, onSend, onHide, onSyncPaste }: SoftKeyboardBarProps) {
  const composingRef = useRef(false);
  const lastSentRef = useRef('');
  const latchedRef = useRef<string[]>([]);
  const showToast = useToast();
  const [latched, setLatched] = useState<string[]>([]);
  latchedRef.current = latched;

  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const initialHeight = viewport.height;
    const initialWidth = viewport.width;
    let keyboardWasVisible = false;
    const syncKeyboard = () => {
      const inset = Math.max(
        keyboardInset(window.innerHeight, viewport.height, viewport.offsetTop),
        Math.abs(viewport.width - initialWidth) < 80 ? initialHeight - viewport.height : 0,
      );
      if (inset > 120) keyboardWasVisible = true;
      else if (keyboardWasVisible && inset < 48) {
        keyboardWasVisible = false;
        onHide();
      }
    };
    syncKeyboard();
    viewport.addEventListener('resize', syncKeyboard);
    viewport.addEventListener('scroll', syncKeyboard);
    return () => {
      viewport.removeEventListener('resize', syncKeyboard);
      viewport.removeEventListener('scroll', syncKeyboard);
    };
  }, [onHide]);

  const focusInput = () => inputRef.current?.focus({ preventScroll: true });

  const toggleModifier = (control: string) => {
    setLatched((current) => toggleLatched(current, control));
    focusInput();
  };

  const tapExtraKey = (control: string) => {
    const next = softControlMessages(latchedRef.current, control, viewOnly);
    latchedRef.current = next.latched;
    setLatched(next.latched);
    if (next.messages.length > 0) onSend(next.messages);
    focusInput();
  };

  const applyDraft = (value: string) => {
    const next = softTextEdit(latchedRef.current, lastSentRef.current, value, viewOnly);
    latchedRef.current = next.latched;
    setLatched(next.latched);
    lastSentRef.current = next.draft;
    if (inputRef.current && inputRef.current.value !== next.draft) inputRef.current.value = next.draft;
    if (next.messages.length > 0) onSend(next.messages);
  };

  return (
    <div
      className="softbar"
      data-testid="softbar"
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => {
        if (event.target instanceof Element && event.target.closest('button')) event.preventDefault();
      }}
    >
      <div className="soft-key-strip" data-testid="soft-key-strip" role="toolbar" aria-label={t(locale, 'specialKeysAria')}>
        {STICKY_MODIFIERS.map((mod) => {
          const isActive = latched.includes(mod.control);
          return (
            <button
              key={mod.control}
              type="button"
              aria-pressed={isActive}
              data-testid={`soft-mod-${mod.label.toLowerCase()}`}
              className={`soft-key-btn${isActive ? ' active' : ''}`}
              onClick={() => toggleModifier(mod.control)}
            >
              {mod.label}
            </button>
          );
        })}
        <span className="soft-key-divider" aria-hidden="true" />
        {EXTRA_KEYS.map((item) => {
          const label = item.labelKey ? t(locale, item.labelKey) : item.label;
          return (
            <button
              key={item.control}
              type="button"
              aria-label={item.ariaKey ? t(locale, item.ariaKey) : label}
              className="soft-key-btn"
              onClick={() => tapExtraKey(item.control)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <button type="button" className="soft-key-btn" data-testid="soft-hide" aria-label={t(locale, 'softHide')} onClick={onHide}>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      <input
        ref={inputRef}
        type="text"
        inputMode="text"
        className="soft-key-capture"
        data-testid="soft-input"
        aria-label={t(locale, 'softPlaceholder')}
        tabIndex={-1}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        onKeyDown={(event) => {
          if (composingRef.current || isImeEvent({ isComposing: event.nativeEvent.isComposing, key: event.key, keyCode: event.keyCode })) return;
          const control = controlFromKeyOrCode(event.code, event.key);
          if (!control || control === 'Space') return;
          if (control === 'Backspace' && latchedRef.current.length === 0 && event.currentTarget.value.length > 0) return;
          event.preventDefault();
          const held = latchedRef.current;
          const next = softControlMessages(held, control, viewOnly);
          latchedRef.current = next.latched;
          setLatched(next.latched);
          if (held.length === 0) {
            const down = next.messages.find((message) => message.type === 'key' && message.action === 'down');
            if (down) onSend([down]);
            if (control === 'Enter') {
              lastSentRef.current = '';
              event.currentTarget.value = '';
            }
          } else if (next.messages.length > 0) {
            onSend(next.messages);
          }
        }}
        onKeyUp={(event) => {
          if (composingRef.current || isImeEvent({ isComposing: event.nativeEvent.isComposing, key: event.key, keyCode: event.keyCode })) return;
          const control = controlFromKeyOrCode(event.code, event.key);
          if (!control || control === 'Space' || latchedRef.current.length > 0) return;
          if (control === 'Backspace' && event.currentTarget.value.length > 0) return;
          event.preventDefault();
          if (!viewOnly) onSend([{ type: 'key', action: 'up', control }]);
        }}
        onPaste={(event) => {
          if (!onSyncPaste || viewOnly) return;
          const text = event.clipboardData.getData('text/plain');
          if (!text) return;
          event.preventDefault();
          if (onSyncPaste(text) !== 'ok') {
            showToast(t(locale, 'clipSyncPasteFailed'), 'error');
            return;
          }
          onSend(textMessages(text, false));
          lastSentRef.current = '';
          event.currentTarget.value = '';
        }}
        onCompositionStart={() => {
          composingRef.current = true;
        }}
        onCompositionEnd={(event) => {
          composingRef.current = false;
          applyDraft(event.currentTarget.value);
        }}
        onInput={(event) => {
          if (composingRef.current) return;
          applyDraft(event.currentTarget.value);
        }}
      />
    </div>
  );
}
