import { X } from 'lucide-react';
import { useState } from 'react';
import { t, type Locale } from '../lib/i18n';

export interface SoftShortcut {
  modifiers: string[];
  key: string;
}

interface KeyChoice {
  value: string;
  label: string;
  aria?: string;
}

export function SoftShortcutSettings({
  locale, modifiers, keys, shortcuts, describe, onAdd, onRemove, onClose,
}: {
  locale: Locale;
  modifiers: readonly KeyChoice[];
  keys: readonly KeyChoice[];
  shortcuts: readonly SoftShortcut[];
  describe: (shortcut: SoftShortcut) => string;
  onAdd: (shortcut: SoftShortcut) => void;
  onRemove: (index: number) => void;
  onClose: () => void;
}) {
  const [selectedModifiers, setSelectedModifiers] = useState<string[]>([]);
  const [key, setKey] = useState('');
  const draft = { modifiers: modifiers.filter(choice => selectedModifiers.includes(choice.value)).map(choice => choice.value), key };
  const alreadyAdded = shortcuts.some(shortcut => shortcut.key === key &&
    shortcut.modifiers.length === draft.modifiers.length &&
    draft.modifiers.every(modifier => shortcut.modifiers.includes(modifier)));
  const addShortcut = () => {
    if (!key || alreadyAdded) return;
    onAdd(draft);
    setKey('');
    setSelectedModifiers([]);
  };

  return (
    <section className="soft-shortcut-settings" role="dialog" aria-label={t(locale, 'softShortcutSettings')}
      data-testid="soft-shortcut-settings"
      onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); onClose(); } }}>
      <header>
        <strong>{t(locale, 'softShortcutSettings')}</strong>
        <button type="button" className="softbar-icon" aria-label={t(locale, 'close')} onClick={onClose}>
          <X size={17} aria-hidden="true" />
        </button>
      </header>
      <div className="soft-shortcut-modifiers" role="group" aria-label={t(locale, 'softShortcutModifiers')}>
        {modifiers.map(choice => <button key={choice.value} type="button" className="soft-key-btn"
          data-shortcut-modifier={choice.value} aria-pressed={selectedModifiers.includes(choice.value)}
          onClick={() => setSelectedModifiers(previous => previous.includes(choice.value)
            ? previous.filter(value => value !== choice.value) : [...previous, choice.value])}>
          {choice.label}
        </button>)}
      </div>
      <div className="soft-shortcut-keys" role="group" aria-label={t(locale, 'softShortcutKey')}>
        {keys.map(choice => <button key={choice.value} type="button" className="soft-key-btn"
          data-shortcut-key={choice.value} aria-label={choice.aria}
          aria-pressed={key === choice.value} onClick={() => setKey(choice.value)}>
          {choice.label}
        </button>)}
      </div>
      <div className="soft-shortcut-footer">
        <output aria-live="polite">{key ? describe(draft) : t(locale, 'softShortcutKey')}</output>
        <button type="button" className="soft-key-btn" data-testid="soft-shortcut-add"
          disabled={!key || alreadyAdded} onClick={addShortcut}>{t(locale, 'softShortcutAdd')}</button>
      </div>
      {shortcuts.length > 0 && (
        <ul className="soft-shortcut-list">
          {shortcuts.map((shortcut, index) => <li key={describe(shortcut)}>
            <span>{describe(shortcut)}</span>
            <button type="button" className="softbar-icon" data-testid="soft-shortcut-remove"
              aria-label={`${t(locale, 'softShortcutRemove')} ${describe(shortcut)}`} onClick={() => onRemove(index)}>
              <X size={16} aria-hidden="true" />
            </button>
          </li>)}
        </ul>
      )}
    </section>
  );
}
