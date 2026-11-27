import type { SoftShortcut } from '../components/SoftShortcutSettings';
import { isModifier } from './keys';

export const STICKY_MODIFIERS = [
  { label: 'Ctrl', control: 'Control' },
  { label: 'Alt', control: 'Alt' },
  { label: 'Shift', control: 'Shift' },
  { label: 'Win', control: 'Meta' },
] as const;

export const EXTRA_KEYS: ReadonlyArray<{ label: string; control: string; aria?: string }> = [
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

export const DEFAULT_FUNCTION_KEYS: SoftShortcut[] = [
  ...STICKY_MODIFIERS.map(({ control }) => ({ key: control, modifiers: [] })),
  { key: 'Escape', modifiers: [] },
];

export const FUNCTION_KEY_CHOICES = EXTRA_KEYS.map(({ control, label, aria }) => ({
  value: control,
  label,
  aria,
}));

export function shortcutId(shortcut: SoftShortcut): string {
  return `${[...shortcut.modifiers].sort().join('-')}:${shortcut.key}`;
}

export function readShortcuts(): SoftShortcut[] {
  try {
    const current = window.localStorage.getItem(SHORTCUT_STORAGE_KEY);
    const saved: unknown = JSON.parse(
      current ?? window.localStorage.getItem(PREVIOUS_SHORTCUT_STORAGE_KEY) ?? '[]',
    );
    if (!Array.isArray(saved)) return DEFAULT_FUNCTION_KEYS;
    const keys = saved.filter(
      (entry): entry is SoftShortcut =>
        typeof entry?.key === 'string' &&
        (FUNCTION_KEY_CHOICES.some((choice) => choice.value === entry.key) ||
          isModifier(entry.key) ||
          /^[a-z0-9]$/.test(entry.key)) &&
        Array.isArray(entry.modifiers) &&
        entry.modifiers.every((value: unknown) => typeof value === 'string' && isModifier(value)) &&
        (!isModifier(entry.key) || entry.modifiers.length === 0),
    );
    const visible = current === null ? [...DEFAULT_FUNCTION_KEYS, ...keys] : keys;
    const seen = new Set<string>();
    return visible.filter((key) => {
      const id = shortcutId(key);
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  } catch {
    return DEFAULT_FUNCTION_KEYS;
  }
}

export function writeShortcuts(next: SoftShortcut[]): void {
  try {
    window.localStorage.setItem(SHORTCUT_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // The current session can continue to use its shortcuts if storage is unavailable.
  }
}

export type VirtualKey =
  | { chr: string; shifted: string; width?: number }
  | { control: string; label: string; aria?: string; width?: number };

function characterKeys(keys: string, shifted = keys.toUpperCase()): VirtualKey[] {
  return [...keys].map((chr, index) => ({ chr, shifted: shifted[index] }));
}

const shiftKey = { control: 'Shift', label: '⇧', aria: 'Shift', width: 1.5 };
const backspaceKey = { control: 'Backspace', label: '⌫', aria: 'Backspace', width: 1.5 };

export const LETTER_ROWS: readonly (readonly VirtualKey[])[] = [
  characterKeys('qwertyuiop'),
  characterKeys('asdfghjkl'),
  [shiftKey, ...characterKeys('zxcvbnm'), backspaceKey],
];

export const NUMBER_ROWS: readonly (readonly VirtualKey[])[] = [
  characterKeys('1234567890', '!@#$%^&*()'),
  characterKeys('@#$%&-+()/', '@#$%&_=[]|'),
  [shiftKey, ...characterKeys(".,?!:';", '<>?!\"~;'), backspaceKey],
];

export const KEYBOARD_BOTTOM_ROW: readonly VirtualKey[] = [
  { control: 'Space', label: 'Space', width: 6 },
  { control: 'Enter', label: 'Enter', width: 2.2 },
];
