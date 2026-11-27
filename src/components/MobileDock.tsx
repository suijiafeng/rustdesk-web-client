import { Activity, ChevronLeft, ChevronRight, Keyboard, Layers2, Monitor, MousePointer2, Pointer } from 'lucide-react';
import { t, type Locale } from '../lib/i18n';
import type { MobilePanel } from './MobileSessionPanel';

interface Props {
  locale: Locale;
  activePanel: MobilePanel | null;
  touchMode: boolean;
  diagnosticsOpen: boolean;
  onToggleDiagnostics: () => void;
  onToggleTouchMode: () => void;
  onToggleKeyboard: () => void;
  onCollapse: () => void;
  onOpenMenu: (panel: MobilePanel) => void;
}

export function MobileDock({
  locale,
  activePanel,
  touchMode,
  diagnosticsOpen,
  onToggleDiagnostics,
  onToggleTouchMode,
  onToggleKeyboard,
  onCollapse,
  onOpenMenu,
}: Props) {
  const buttons = [
    {
      id: 'dock-keyboard',
      label: t(locale, 'keyboard'),
      Icon: Keyboard,
      action: onToggleKeyboard,
      active: false,
      ariaLabel: undefined,
      pressed: undefined,
      expanded: undefined,
    },
    {
      id: 'dock-input-mode',
      label: t(locale, touchMode ? 'touch' : 'mouse'),
      Icon: touchMode ? Pointer : MousePointer2,
      action: onToggleTouchMode,
      active: !touchMode,
      ariaLabel: t(locale, 'toggleInputMode'),
      pressed: touchMode,
      expanded: undefined,
    },
    {
      id: 'dock-display',
      label: t(locale, 'screens'),
      Icon: Monitor,
      action: () => onOpenMenu('display'),
      active: activePanel === 'display',
      ariaLabel: undefined,
      pressed: undefined,
      expanded: activePanel === 'display',
    },
    {
      id: 'dock-monitor',
      label: t(locale, 'dockMonitor'),
      Icon: Activity,
      action: onToggleDiagnostics,
      active: diagnosticsOpen,
      ariaLabel: undefined,
      pressed: diagnosticsOpen,
      expanded: diagnosticsOpen,
    },
    {
      id: 'dock-menu',
      label: t(locale, 'moreActions'),
      Icon: Layers2,
      action: () => onOpenMenu('actions'),
      active: activePanel === 'actions',
      ariaLabel: undefined,
      pressed: undefined,
      expanded: activePanel === 'actions',
    },
  ];

  if (activePanel) return (
    <nav className="remote-tools" data-testid="mobile-dock" aria-label={t(locale, 'session')} onPointerDown={e => e.stopPropagation()}>
      {buttons.map(({ id, label, Icon, action, active, ariaLabel, pressed, expanded }) => (
        <button key={id} type="button" data-testid={id} className={active ? 'selected' : ''}
          aria-label={ariaLabel}
          aria-pressed={pressed}
          aria-expanded={expanded}
          onClick={action}>
          <Icon size={20} /><span>{label}</span>
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
