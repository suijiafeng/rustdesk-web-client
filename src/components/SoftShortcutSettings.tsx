import { Check, X } from 'lucide-react';
import { t, type Locale } from '../lib/i18n';

export interface SoftShortcut {
  modifiers: string[];
  key: string;
}

interface ShortcutOption {
  id: string;
  label: string;
  aria?: string;
  selected: boolean;
  shortcut: SoftShortcut;
}

export function SoftShortcutSettings({ locale, options, onToggle, onClose }: {
  locale: Locale;
  options: readonly ShortcutOption[];
  onToggle: (shortcut: SoftShortcut) => void;
  onClose: () => void;
}) {
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
      <div className="soft-shortcut-options">
        {options.map(({ id, label, aria, selected, shortcut }) => (
          <button key={id} type="button" className="soft-shortcut-chip" data-shortcut-option={id}
            aria-label={aria} aria-pressed={selected} title={label} onClick={() => onToggle(shortcut)}>
            <span>{label}</span>{selected && <Check size={13} aria-hidden="true" />}
          </button>
        ))}
      </div>
    </section>
  );
}
