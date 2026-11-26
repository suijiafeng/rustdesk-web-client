import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Keyboard, ListPlus } from 'lucide-react';
import type { SoftKeyboardMode } from '../hooks/useKeyboardViewport';
import { keyboardInset } from '../lib/gestures';
import { SOFT_KEYBOARD_BAR_HEIGHT } from '../lib/keyboardViewport';
import { SoftShortcutSettings, type SoftShortcut } from './SoftShortcutSettings';
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
  viewportHeight: number;
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
  { label: 'Caps Lock', control: 'CapsLock' },
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

const SHORTCUT_STORAGE_KEY = 'rd_web_soft_function_keys';
const PREVIOUS_SHORTCUT_STORAGE_KEY = 'rd_web_soft_shortcuts';
const DEFAULT_FUNCTION_KEYS: SoftShortcut[] = [
  ...STICKY_MODIFIERS.map(({ control }) => ({ key: control, modifiers: [] })),
  { key: 'Escape', modifiers: [] },
];
const FUNCTION_KEY_CHOICES = EXTRA_KEYS.map(({ control, label, aria }) => ({ value: control, label, aria }));

function shortcutId(shortcut: SoftShortcut): string {
  return `${[...shortcut.modifiers].sort().join('-')}:${shortcut.key}`;
}

function readShortcuts(): SoftShortcut[] {
  try {
    const current = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
    const saved: unknown = JSON.parse(current ?? window.localStorage.getItem(PREVIOUS_SHORTCUT_STORAGE_KEY) ?? '[]');
    if (!Array.isArray(saved)) return DEFAULT_FUNCTION_KEYS;
    const keys = saved.filter((entry): entry is SoftShortcut =>
      typeof entry?.key === 'string' &&
      (FUNCTION_KEY_CHOICES.some(choice => choice.value === entry.key) || isModifier(entry.key) || /^[a-z0-9]$/.test(entry.key)) &&
      Array.isArray(entry.modifiers) &&
      entry.modifiers.every((value: unknown) => typeof value === 'string' && isModifier(value)) &&
      (!isModifier(entry.key) || entry.modifiers.length === 0),
    );
    const visible = current === null ? [...DEFAULT_FUNCTION_KEYS, ...keys] : keys;
    const seen = new Set<string>();
    return visible.filter(key => {
      const id = shortcutId(key);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  } catch {
    return DEFAULT_FUNCTION_KEYS;
  }
}

const KEY_FEEDBACK_MS = 140;
type VirtualKey =
  | { chr: string; shifted: string; width?: number }
  | { control: string; label: string; aria?: string; width?: number };

function characterKeys(keys: string, shifted = keys.toUpperCase()): VirtualKey[] {
  return [...keys].map((chr, index) => ({ chr, shifted: shifted[index] }));
}

const shiftKey = { control: 'Shift', label: '⇧', aria: 'Shift', width: 1.5 };
const backspaceKey = { control: 'Backspace', label: '⌫', aria: 'Backspace', width: 1.5 };
const LETTER_ROWS: readonly (readonly VirtualKey[])[] = [
  characterKeys('qwertyuiop'),
  characterKeys('asdfghjkl'),
  [shiftKey, ...characterKeys('zxcvbnm'), backspaceKey],
];
const NUMBER_ROWS: readonly (readonly VirtualKey[])[] = [
  characterKeys('1234567890', '!@#$%^&*()'),
  characterKeys('@#$%&-+()/', '@#$%&_=[]|'),
  [shiftKey, ...characterKeys(".,?!:';", '<>?!\"~;'), backspaceKey],
];
const KEYBOARD_BOTTOM_ROW: readonly VirtualKey[] = [
  { control: 'Space', label: 'Space', width: 6 },
  { control: 'Enter', label: 'Enter', width: 2.2 },
];

export function SoftKeyboardBar({
  locale,
  remotePlatform,
  inputRef,
  mode,
  reservedSpace,
  viewportHeight,
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
  const [numberPage, setNumberPage] = useState(false);
  const [shortcuts, setShortcuts] = useState(readShortcuts);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsRegion = useRef<HTMLDivElement>(null);
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

  const shortcutModifiers = STICKY_MODIFIERS.map(mod => ({ value: mod.control, label: modifierLabel(mod.control, mod.label) }));
  const shortcutChoices = [...shortcutModifiers, ...FUNCTION_KEY_CHOICES];
  const describeShortcut = (shortcut: SoftShortcut) => [
    ...shortcut.modifiers.map(control => shortcutModifiers.find(choice => choice.value === control)?.label ?? control),
    shortcutChoices.find(choice => choice.value === shortcut.key)?.label ?? shortcut.key.toUpperCase(),
  ].join('+');

  const saveShortcuts = (next: SoftShortcut[]) => {
    setShortcuts(next);
    try {
      window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // The current session can continue to use its shortcuts if storage is unavailable.
    }
  };

  useEffect(() => {
    if (!settingsOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (event.target instanceof Node && !settingsRegion.current?.contains(event.target)) setSettingsOpen(false);
    };
    document.addEventListener('pointerdown', dismiss, true);
    return () => document.removeEventListener('pointerdown', dismiss, true);
  }, [settingsOpen]);

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

  const sendShortcut = (shortcut: SoftShortcut) => {
    if (shortcut.modifiers.length === 0 && isModifier(shortcut.key)) {
      toggleModifier(shortcut.key);
      return;
    }
    const key = shortcut.key.length === 1 ? { chr: shortcut.key } : { control: shortcut.key };
    if (shortcut.modifiers.length === 0) {
      tapKey(key);
      return;
    }
    onSendChord(buildSoftKeyChord(shortcut.modifiers, key));
    setLatched([]);
    focusSystemInput();
  };

  const toggleShortcut = (shortcut: SoftShortcut) => {
    const id = shortcutId(shortcut);
    if (!shortcuts.some(item => shortcutId(item) === id)) {
      saveShortcuts([...shortcuts, shortcut]);
      return;
    }
    if (!shortcut.modifiers.length && isModifier(shortcut.key)) {
      setLatched(previous => previous.filter(value => value !== shortcut.key));
    }
    saveShortcuts(shortcuts.filter(item => shortcutId(item) !== id));
  };

  const shortcutOptions = [
    ...shortcutChoices.map(choice => ({ key: choice.value, modifiers: [] })),
    ...shortcuts.filter(shortcut => shortcut.modifiers.length > 0 || shortcut.key.length === 1),
  ].map(shortcut => {
    const id = shortcutId(shortcut);
    const choice = shortcutChoices.find(item => item.value === shortcut.key);
    return {
      id,
      label: describeShortcut(shortcut),
      aria: !shortcut.modifiers.length && choice && 'aria' in choice ? choice.aria : undefined,
      selected: shortcuts.some(item => shortcutId(item) === id),
      shortcut,
    };
  });

  const changeKeyboardMode = (next: SoftKeyboardMode) => {
    if (mode === next) return;
    if (next === 'system') setNumberPage(false);
    onSwitchMode(next);
    resetLocalDraft();
    composingRef.current = false;
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
      style={{
        '--soft-key-space': `${reservedSpace}px`,
        '--softbar-height': `${SOFT_KEYBOARD_BAR_HEIGHT}px`,
        '--soft-shortcut-space': `${Math.max(0, viewportHeight - reservedSpace - SOFT_KEYBOARD_BAR_HEIGHT - 8)}px`,
      } as React.CSSProperties}
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
      <div className="soft-function-row" data-testid="soft-function-row">
        <div ref={settingsRegion}>
          <button type="button" className="softbar-icon" data-testid="soft-shortcut-toggle"
            aria-label={t(locale, 'softShortcutSettings')} aria-expanded={settingsOpen}
            onClick={() => setSettingsOpen(open => !open)}>
            <ListPlus size={18} aria-hidden="true" />
          </button>
          {settingsOpen && <SoftShortcutSettings
            locale={locale}
            options={shortcutOptions}
            onToggle={toggleShortcut}
            onClose={() => setSettingsOpen(false)}
          />}
        </div>
        <div
          className="soft-key-strip"
          data-testid="soft-key-strip"
          role="toolbar"
          aria-label={t(locale, 'specialKeysAria')}
        >
          {shortcuts.map(shortcut => {
            const label = describeShortcut(shortcut);
            const isCombo = shortcut.modifiers.length > 0;
            const modifier = isCombo ? undefined : STICKY_MODIFIERS.find(item => item.control === shortcut.key);
            const isActive = modifier ? latched.includes(modifier.control) : undefined;
            const feedbackId = `shortcut-${shortcutId(shortcut)}`;
            const choice = shortcutChoices.find(item => item.value === shortcut.key);
            return <button key={feedbackId} type="button"
              className={`soft-key-btn${isCombo ? ' soft-shortcut-button' : ''}${isActive ? ' active' : ''}`}
              data-testid={modifier ? `soft-mod-${modifier.label.toLowerCase()}` : isCombo ? 'soft-shortcut' : undefined}
              data-function-key={!isCombo ? shortcut.key : undefined}
              aria-label={!isCombo && choice && 'aria' in choice ? choice.aria : undefined}
              aria-pressed={isActive}
              data-key-feedback={feedbackId}
              data-key-pressed={pressedKey === feedbackId || undefined}
              onClick={() => sendShortcut(shortcut)}>
              {label}
            </button>;
          })}
        </div>
      </div>

      <div className="soft-operation-row" data-testid="soft-operation-row">
        <div className="soft-keyboard-tabs" role="group" aria-label={t(locale, 'softKeyboardType')}>
          <button type="button" data-testid="soft-keyboard-virtual" aria-pressed={mode === 'virtual'}
            onClick={() => changeKeyboardMode('virtual')}>{t(locale, 'softComputerKeyboard')}</button>
          <button type="button" data-testid="soft-keyboard-system" aria-pressed={mode === 'system'}
            onClick={() => changeKeyboardMode('system')}>{t(locale, 'softPhoneKeyboard')}</button>
        </div>
        <button type="button" className="softbar-icon soft-keyboard-hide" data-testid="soft-hide"
          aria-label={t(locale, 'softHide')} onClick={onHide}>
          <Keyboard size={19} aria-hidden="true" />
          <ChevronDown size={13} aria-hidden="true" />
        </button>
      </div>
      {mode === 'virtual' && (
        <div className="virtual-keyboard" data-testid="virtual-keyboard"
          role="group" aria-label={t(locale, 'softVirtualKeyboard')} inert={reservedSpace < 80}
          data-keyboard-page={numberPage ? 'numbers' : 'letters'}>
          {[...(numberPage ? NUMBER_ROWS : LETTER_ROWS), KEYBOARD_BOTTOM_ROW].map((row, rowIndex) => (
            <div className="virtual-keyboard-row" key={rowIndex}>
              {row === KEYBOARD_BOTTOM_ROW && (
                <button type="button" className="soft-key-btn virtual-keyboard-page"
                  data-testid="virtual-keyboard-page" data-key-feedback="keyboard-page"
                  data-key-pressed={pressedKey === 'keyboard-page' || undefined}
                  aria-label={t(locale, numberPage ? 'softLetterKeys' : 'softNumberKeys')}
                  onClick={() => setNumberPage(previous => !previous)}>
                  {numberPage ? 'ABC' : '123'}
                </button>
              )}
              {row.map((key, keyIndex) => {
                const control = 'control' in key ? key.control : undefined;
                const label = 'control' in key ? key.label : shiftActive ? key.shifted : key.chr;
                const alternate = 'chr' in key && numberPage && key.shifted !== key.chr
                  ? (shiftActive ? key.chr : key.shifted) : undefined;
                const modifierActive = control && isModifier(control) ? latched.includes(control) : undefined;
                const feedbackId = 'chr' in key
                  ? (/[a-z]/.test(key.chr) ? `letter-${key.chr}` : `symbol-${key.chr}`)
                  : `virtual-${control}-${rowIndex}-${keyIndex}`;
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
