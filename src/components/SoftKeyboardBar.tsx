import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { SoftKeyboardMode } from '../hooks/useKeyboardViewport';
import { keyboardInset } from '../lib/gestures';
import { t, type Locale } from '../lib/i18n';
import {
  buildSoftKeyChord,
  controlFromKeyOrCode,
  diffTextInput,
  isImeEvent,
  isModifier,
  remoteKeyboardProfile,
  type SoftChordPart,
} from '../lib/keys';

interface SoftKeyboardBarProps {
  locale: Locale;
  remotePlatform?: string;
  inputRef: React.RefObject<HTMLInputElement | null>;
  mode: SoftKeyboardMode;
  reservedSpace: number;
  onSwitchMode: (mode: SoftKeyboardMode) => void;
  onSendText: (text: string) => void;
  onPasteText?: (text: string) => void;
  onSendControl: (action: 'down' | 'up', control: string) => void;
  onSendChord: (parts: SoftChordPart[]) => void;
  onHide: () => void;
}

const STICKY_MODIFIERS = [
  { label: 'Ctrl', control: 'Control' },
  { label: 'Alt', control: 'Alt' },
  { label: 'Shift', control: 'Shift' },
  { label: 'Win', control: 'Meta' },
] as const;

const EXTRA_KEYS: ReadonlyArray<{ label: string; control: string; aria?: string }> = [
  { label: 'Esc', control: 'Escape' },
  { label: 'Tab', control: 'Tab' },
  { label: 'Space', control: 'Space' },
  { label: 'Enter', control: 'Enter' },
  { label: 'Backspace', control: 'Backspace' },
  { label: '←', control: 'ArrowLeft', aria: 'Left arrow' },
  { label: '↑', control: 'ArrowUp', aria: 'Up arrow' },
  { label: '↓', control: 'ArrowDown', aria: 'Down arrow' },
  { label: '→', control: 'ArrowRight', aria: 'Right arrow' },
  { label: 'Home', control: 'Home' },
  { label: 'End', control: 'End' },
  { label: 'Page Up', control: 'PageUp' },
  { label: 'Page Down', control: 'PageDown' },
  { label: 'Del', control: 'Delete' },
] as const;

const KEY_FEEDBACK_MS = 140;
type VirtualKey =
  | { chr: string; shifted: string; width?: number }
  | { control: string; label: string; aria?: string; width?: number };

function characterKeys(keys: string, shifted: string): VirtualKey[] {
  return [...keys].map((chr, index) => ({ chr, shifted: shifted[index] }));
}

const VIRTUAL_ROWS: readonly (readonly VirtualKey[])[] = [
  [
    ...characterKeys('`1234567890-=', '~!@#$%^&*()_+'),
    { control: 'Backspace', label: '⌫', aria: 'Backspace', width: 2 },
  ],
  [
    { control: 'Tab', label: 'Tab', width: 1.5 },
    ...characterKeys('qwertyuiop[]', 'QWERTYUIOP{}'),
    { chr: '\\', shifted: '|', width: 1.5 },
  ],
  [
    { control: 'CapsLock', label: 'Caps', aria: 'Caps Lock', width: 1.75 },
    ...characterKeys("asdfghjkl;'", 'ASDFGHJKL:"'),
    { control: 'Enter', label: 'Enter', width: 2.25 },
  ],
  [
    { control: 'Shift', label: 'Shift', width: 2.25 },
    ...characterKeys('zxcvbnm,./', 'ZXCVBNM<>?'),
    { control: 'Shift', label: 'Shift', width: 2.75 },
  ],
];

const VIRTUAL_BOTTOM_ROW: readonly VirtualKey[] = [
  { control: 'Control', label: 'Ctrl', width: 1.5 },
  { control: 'Meta', label: 'Win', width: 2 },
  { control: 'Alt', label: 'Alt', width: 1.75 },
  { control: 'Space', label: 'Space', width: 5.75 },
  { control: 'ArrowLeft', label: '←', aria: 'Left arrow' },
  { control: 'ArrowDown', label: '↓', aria: 'Down arrow' },
  { control: 'ArrowUp', label: '↑', aria: 'Up arrow' },
  { control: 'ArrowRight', label: '→', aria: 'Right arrow' },
];
const [controlKey, metaKey, altKey, ...bottomKeys] = VIRTUAL_BOTTOM_ROW;
const MAC_VIRTUAL_BOTTOM_ROW = [controlKey, altKey, metaKey, ...bottomKeys];

export function SoftKeyboardBar({
  locale,
  remotePlatform,
  inputRef,
  mode,
  reservedSpace,
  onSwitchMode,
  onSendText,
  onPasteText,
  onSendControl,
  onSendChord,
  onHide,
}: SoftKeyboardBarProps) {
  const { altLabel, metaLabel } = remoteKeyboardProfile(remotePlatform);
  const composingRef = useRef(false);
  const lastSentRef = useRef('');
  const [latched, setLatched] = useState<string[]>([]);
  const [pressedKey, setPressedKey] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(feedbackTimer.current), []);

  const showKeyFeedback = (target: EventTarget) => {
    if (!(target instanceof Element)) return;
    const key = target.closest<HTMLButtonElement>('button[data-key-feedback]')?.dataset.keyFeedback;
    if (!key) return;
    clearTimeout(feedbackTimer.current);
    setPressedKey(key);
    feedbackTimer.current = setTimeout(() => setPressedKey(null), KEY_FEEDBACK_MS);
  };
  const shiftActive = latched.includes('Shift');
  const modifierLabel = (control: string, label: string) =>
    control === 'Meta' ? metaLabel : control === 'Alt' ? altLabel : label;

  useEffect(() => {
    if (mode !== 'system') return;
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
      if (inset > 80) {
        keyboardWasVisible = true;
      } else if (keyboardWasVisible && inset < 24) {
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
  }, [mode, onHide]);

  const resetLocalDraft = () => {
    lastSentRef.current = '';
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  const focusSystemInput = () => {
    if (mode === 'system') inputRef.current?.focus({ preventScroll: true });
  };

  const toggleModifier = (control: string) => {
    setLatched(prev => prev.includes(control) ? prev.filter(m => m !== control) : [...prev, control]);
    focusSystemInput();
  };

  const tapKey = (key: SoftChordPart) => {
    if (latched.length > 0) {
      onSendChord(buildSoftKeyChord(latched, key));
      setLatched([]);
    } else if (key.control) {
      onSendControl('down', key.control);
      onSendControl('up', key.control);
    } else if (key.chr) {
      onSendText(key.chr);
    }
    focusSystemInput();
  };

  const tapVirtualKey = (key: VirtualKey) => {
    if ('control' in key) {
      if (isModifier(key.control)) toggleModifier(key.control);
      else tapKey({ control: key.control });
      return;
    }
    if (shiftActive && latched.length === 1) {
      setLatched([]);
      onSendText(key.shifted);
      return;
    }
    tapKey({ chr: key.chr });
  };

  const syncInputValue = (el: HTMLInputElement) => {
    const nextVal = el.value;
    const prevVal = lastSentRef.current;

    if (latched.length > 0) {
      const diff = diffTextInput(prevVal, nextVal);
      if (diff.insert) {
        const chars = Array.from(diff.insert);
        const first = chars.shift();
        if (first) {
          onSendChord(buildSoftKeyChord(latched, { chr: first.toLowerCase() }));
        }
        setLatched([]);
        // Restore local draft without leaving the shortcut character behind
        el.value = prevVal;
        if (chars.length > 0) {
          onSendText(chars.join(''));
        }
        return;
      }
    }

    const diff = diffTextInput(prevVal, nextVal);
    if (diff.backspaces === 0 && !diff.insert) {
      return;
    }

    for (let i = 0; i < diff.backspaces; i += 1) {
      onSendControl('down', 'Backspace');
      onSendControl('up', 'Backspace');
    }
    if (diff.insert) {
      onSendText(diff.insert);
    }

    lastSentRef.current = nextVal;
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      composingRef.current ||
      isImeEvent({
        isComposing: e.nativeEvent.isComposing,
        key: e.key,
        keyCode: e.keyCode,
      })
    ) {
      return;
    }

    const control = controlFromKeyOrCode(e.code, e.key);
    if (!control || control === 'Space') return;

    // When the local buffer has text and no modifiers are latched, let native Backspace
    // edit the input buffer and forward the exact diff via handleInput.
    if (control === 'Backspace' && latched.length === 0 && e.currentTarget.value.length > 0) {
      return;
    }

    e.preventDefault();
    if (latched.length > 0) {
      onSendChord(buildSoftKeyChord(latched, { control }));
      setLatched([]);
    } else {
      onSendControl('down', control);
    }

    if (control === 'Enter') {
      resetLocalDraft();
    }
  };

  const handleKeyUp = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (
      composingRef.current ||
      isImeEvent({
        isComposing: e.nativeEvent.isComposing,
        key: e.key,
        keyCode: e.keyCode,
      })
    ) {
      return;
    }
    const control = controlFromKeyOrCode(e.code, e.key);
    if (control && control !== 'Space' && latched.length === 0) {
      if (control === 'Backspace' && e.currentTarget.value.length > 0) {
        return;
      }
      e.preventDefault();
      onSendControl('up', control);
    }
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const handleCompositionEnd = (e: React.CompositionEvent<HTMLInputElement>) => {
    composingRef.current = false;
    syncInputValue(e.currentTarget);
  };

  const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
    if (composingRef.current) return;
    syncInputValue(e.currentTarget);
  };

  return (
    <div
      className="softbar"
      data-testid="softbar"
      data-keyboard-mode={mode}
      style={{ '--soft-key-space': `${reservedSpace}px` } as React.CSSProperties}
      onPointerDown={e => {
        showKeyFeedback(e.target);
        e.stopPropagation();
      }}
      onClickCapture={e => showKeyFeedback(e.target)}
      onMouseDown={(e) => {
        if (e.target instanceof Element && e.target.closest('button')) {
          e.preventDefault();
        }
      }}
    >
      <div
        className="soft-key-strip"
        data-testid="soft-key-strip"
        role="toolbar"
        aria-label={t(locale, 'specialKeysAria')}
      >
        {STICKY_MODIFIERS.map((mod) => {
          const isActive = latched.includes(mod.control);
          return (
            <button
              key={mod.control}
              type="button"
              aria-pressed={isActive}
              data-testid={`soft-mod-${mod.label.toLowerCase()}`}
              data-key-feedback={`modifier-${mod.control}`}
              data-key-pressed={pressedKey === `modifier-${mod.control}` || undefined}
              className={`soft-key-btn${isActive ? ' active' : ''}`}
              onClick={() => toggleModifier(mod.control)}
            >
              {modifierLabel(mod.control, mod.label)}
            </button>
          );
        })}
        <span className="soft-key-divider" aria-hidden="true" />
        {EXTRA_KEYS.map((item) => (
          <button
            key={item.control}
            type="button"
            aria-label={item.aria ?? item.label}
            className="soft-key-btn"
            data-key-feedback={`toolbar-${item.control}`}
            data-key-pressed={pressedKey === `toolbar-${item.control}` || undefined}
            onClick={() => tapKey({ control: item.control })}
          >
            {item.label}
          </button>
        ))}
      </div>

      <button type="button" className="soft-key-btn" data-testid="soft-keyboard-switch"
        onClick={() => {
          onSwitchMode(mode === 'system' ? 'virtual' : 'system');
          resetLocalDraft();
          composingRef.current = false;
        }}>
        {t(locale, mode === 'system' ? 'softVirtualKeyboard' : 'softSystemKeyboard')}
      </button>
      <button
        type="button"
        className="soft-key-btn"
        data-testid="soft-hide"
        aria-label={t(locale, 'softHide')}
        onClick={onHide}
      >
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {mode === 'virtual' && (
        <div className="virtual-keyboard" data-testid="virtual-keyboard"
          role="group" aria-label={t(locale, 'softVirtualKeyboard')} inert={reservedSpace < 80}>
          {[...VIRTUAL_ROWS, metaLabel === 'Command' ? MAC_VIRTUAL_BOTTOM_ROW : VIRTUAL_BOTTOM_ROW].map((row, rowIndex) => (
            <div className="virtual-keyboard-row" key={rowIndex}>
              {row.map((key, keyIndex) => {
                const control = 'control' in key ? key.control : undefined;
                const label = 'control' in key ? modifierLabel(key.control, key.label)
                  : /^[a-z]$/.test(key.chr) ? key.shifted : shiftActive ? key.shifted : key.chr;
                const alternate = 'chr' in key && !/^[a-z]$/.test(key.chr)
                  ? (shiftActive ? key.chr : key.shifted) : undefined;
                const modifierActive = control && isModifier(control) ? latched.includes(control) : undefined;
                const feedbackId = 'chr' in key ? `letter-${key.chr}` : `virtual-${control}-${rowIndex}-${keyIndex}`;
                return <button type="button" className={`soft-key-btn${modifierActive ? ' active' : ''}`}
                  key={feedbackId}
                  style={{ '--virtual-key-width': key.width ?? 1 } as React.CSSProperties}
                  data-key={control}
                  aria-label={'control' in key ? key.aria ?? label : label}
                  aria-pressed={modifierActive}
                  data-key-feedback={feedbackId}
                  data-key-pressed={pressedKey === feedbackId || undefined}
                  onClick={() => tapVirtualKey(key)}>
                  {alternate !== undefined && <span className="virtual-key-alternate" aria-hidden="true">{alternate}</span>}
                  <span>{label}</span>
                </button>;
              })}
            </div>
          ))}
        </div>
      )}
      {mode === 'system' && <input
        ref={inputRef}
        type="text"
        className="soft-key-capture"
        data-testid="soft-input"
        aria-label={t(locale, 'softPlaceholder')}
        tabIndex={-1}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onCompositionStart={handleCompositionStart}
        onCompositionEnd={handleCompositionEnd}
        onInput={handleInput}
        onPaste={e => {
          const text = e.clipboardData.getData('text/plain');
          if (!text) return;
          if (!onPasteText) return;
          e.preventDefault();
          onPasteText(text);
          onSendText(text);
          resetLocalDraft();
        }}
      />}
    </div>
  );
}
