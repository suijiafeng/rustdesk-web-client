import { ChevronLeft, ChevronRight, Keyboard, Layers2, Monitor, MousePointer2, Pointer } from 'lucide-react';
import { t, type Locale } from '../lib/i18n';
import type { MobilePanel } from './MobileSessionPanel';

interface Props {
  locale: Locale;
  activePanel: MobilePanel | null;
  touchMode: boolean;
  onToggleTouchMode: () => void;
  onToggleKeyboard: () => void;
  onCollapse: () => void;
  onOpenMenu: (panel: MobilePanel) => void;
}

export function MobileDock({ locale, activePanel, touchMode, onToggleTouchMode, onToggleKeyboard, onCollapse, onOpenMenu }: Props) {
  const buttons = [
    ['dock-keyboard', 'keyboard', Keyboard, onToggleKeyboard, false],
    ['dock-input-mode', touchMode ? 'touch' : 'mouse', touchMode ? Pointer : MousePointer2, onToggleTouchMode, !touchMode],
    ['dock-display', 'screens', Monitor, () => onOpenMenu('display'), activePanel === 'display'],
    ['dock-menu', 'moreActions', Layers2, () => onOpenMenu('actions'), activePanel === 'actions'],
  ] as const;

  if (activePanel) return (
    <nav className="remote-tools" data-testid="mobile-dock" aria-label={t(locale, 'session')} onPointerDown={e => e.stopPropagation()}>
      {buttons.map(([id, label, Icon, action, active]) => (
        <button key={id} type="button" data-testid={id} className={active ? 'selected' : ''}
          aria-label={id === 'dock-input-mode' ? t(locale, 'toggleInputMode') : undefined}
          aria-pressed={id === 'dock-input-mode' ? touchMode : undefined}
          aria-expanded={id === 'dock-menu' || id === 'dock-display' ? active : undefined}
          onClick={action}>
          <Icon size={20} /><span>{t(locale, label)}</span>
        </button>
      ))}
      <button type="button" data-testid="dock-collapse" aria-label={t(locale, 'dockHideControls')} onClick={onCollapse}>
        <ChevronRight size={20} />
      </button>
    </nav>
  );

  return (
    <div className="remote-capsule" data-testid="mobile-capsule"
      onPointerDown={e => e.stopPropagation()}
      onContextMenu={e => e.preventDefault()}>
      <button type="button" data-testid="mobile-dock-expand" aria-label={t(locale, 'openSessionMenu')} onClick={() => onOpenMenu('toolbar')}><ChevronLeft /></button>
      <button type="button" data-testid="capsule-keyboard" aria-label={t(locale, 'keyboard')} onClick={onToggleKeyboard}><Keyboard /></button>
    </div>
  );
}
