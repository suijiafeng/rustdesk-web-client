// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useState } from 'react';
import { ChevronLeft, ChevronRight, CircleHelp, Keyboard, Layers2, Monitor, MousePointer2, Pointer } from 'lucide-react';
import { t, type I18nKey } from '../lib/i18n.ts';
import { classifyRemoteOs, remoteFeatures } from '../lib/platform.ts';
import { MobileActionsMenu, type MobileActionsMenuProps } from './mobile/MobileActionsMenu.tsx';
import { MobileDisplayMenu, type MobileDisplayMenuProps } from './mobile/MobileDisplayMenu.tsx';
import { MobileGestureGuide } from './mobile/MobileGestureGuide.tsx';

const menuLabels = {
  display: 'screens',
  gestures: 'dockGuide',
  actions: 'moreActions',
} as const;

type DockMenu = keyof typeof menuLabels;
type DockView = 'collapsed' | 'toolbar' | DockMenu;

interface MobileSessionDockProps extends MobileDisplayMenuProps, MobileActionsMenuProps {
  touchMode: boolean;
  remotePlatform: string;
  onToggleKeyboard: () => void;
  onToggleTouchMode: () => void;
  onQuickKey: (name: 'Ctrl+Alt+Del' | 'Lock') => void;
}

export function MobileSessionDock(props: MobileSessionDockProps) {
  const { locale, touchMode, remotePlatform, onToggleKeyboard, onToggleTouchMode, onQuickKey } = props;
  const features = remoteFeatures(classifyRemoteOs(remotePlatform));
  const [dockView, setDockView] = useState<DockView>('collapsed');

  const label = (key: I18nKey) => t(locale, key);
  const collapseDock = () => setDockView('collapsed');

  function renderMenu(menu: DockMenu) {
    switch (menu) {
      case 'display':
        return (
          <MobileDisplayMenu
            locale={locale}
            displays={props.displays}
            currentDisplay={props.currentDisplay}
            viewOnly={props.viewOnly}
            followWindow={props.followWindow}
            onToggleFollowWindow={props.onToggleFollowWindow}
            onSwitchDisplay={props.onSwitchDisplay}
            resolutions={props.resolutions}
            frameWidth={props.frameWidth}
            frameHeight={props.frameHeight}
            onResolution={props.onResolution}
            canChangeResolution={features.resolutionChange}
            quality={props.quality}
            targetFps={props.targetFps}
            codec={props.codec}
            codecSupport={props.codecSupport}
            onQuality={props.onQuality}
            onFps={props.onFps}
            onCodec={props.onCodec}
          />
        );
      case 'gestures':
        return <MobileGestureGuide locale={locale} touchMode={touchMode} />;
      case 'actions':
        return (
          <MobileActionsMenu
            locale={locale}
            viewOnly={props.viewOnly}
            audioEnabled={props.audioEnabled}
            onToggleAudio={props.onToggleAudio}
            clipboardSync={props.clipboardSync}
            clipboardPermitted={props.clipboardPermitted}
            onToggleClipboardSync={props.onToggleClipboardSync}
            privacyAllowed={features.privacyMode && props.privacyAllowed}
            privacyEnabled={props.privacyEnabled}
            privacyPending={props.privacyPending}
            onTogglePrivacy={props.onTogglePrivacy}
            diagnosticsOpen={props.diagnosticsOpen}
            onToggleDiagnostics={props.onToggleDiagnostics}
            restartAllowed={features.restart && props.restartAllowed}
            restartPending={props.restartPending}
            onRestart={props.onRestart}
            onDisconnect={props.onDisconnect}
            canLockScreen={features.lockScreen}
            onLockScreen={() => onQuickKey('Lock')}
          />
        );
    }
  }

  if (dockView === 'collapsed') {
    return (
      <div
        className="remote-capsule"
        data-testid="mobile-capsule"
        onPointerDown={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <button type="button" data-testid="mobile-dock-expand" aria-label={label('openSessionMenu')} onClick={() => setDockView('toolbar')}>
          <ChevronLeft size={20} />
        </button>
        <button type="button" data-testid="capsule-keyboard" aria-label={label('keyboard')} onClick={onToggleKeyboard}>
          <Keyboard size={20} />
        </button>
      </div>
    );
  }

  const ModeIcon = touchMode ? Pointer : MousePointer2;
  return (
    <>
      <div
        className="remote-menu-backdrop"
        data-testid="session-backdrop"
        onPointerDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          if (event.target === event.currentTarget) collapseDock();
        }}
      >
        {dockView !== 'toolbar' ? (
          <section className="remote-menu-panel" role="dialog" aria-label={label(menuLabels[dockView])} data-testid="session-menu">
            {renderMenu(dockView)}
          </section>
        ) : null}
      </div>
      <nav className="remote-tools" data-testid="mobile-dock" aria-label={label('session')} onPointerDown={(event) => event.stopPropagation()}>
        <button type="button" data-testid="dock-keyboard" onClick={onToggleKeyboard}>
          <Keyboard size={20} />
          <span>{label('keyboard')}</span>
        </button>
        <button
          type="button"
          data-testid="dock-input-mode"
          aria-label={label('toggleInputMode')}
          aria-pressed={!touchMode}
          className={!touchMode ? 'selected' : undefined}
          onClick={onToggleTouchMode}
        >
          <ModeIcon size={20} />
          <span>{label(touchMode ? 'touch' : 'mouse')}</span>
        </button>
        <button type="button" data-testid="dock-display" className={dockView === 'display' ? 'selected' : ''} onClick={() => setDockView('display')}>
          <Monitor size={20} />
          <span>{label('screens')}</span>
        </button>
        <button type="button" data-testid="dock-gestures" className={dockView === 'gestures' ? 'selected' : ''} onClick={() => setDockView('gestures')}>
          <CircleHelp size={20} />
          <span>{label('dockGuide')}</span>
        </button>
        <button type="button" data-testid="dock-menu" className={dockView === 'actions' ? 'selected' : ''} onClick={() => setDockView('actions')}>
          <Layers2 size={20} />
          <span>{label('moreActions')}</span>
        </button>
        <button type="button" data-testid="dock-collapse" aria-label={label('dockHideControls')} onClick={collapseDock}>
          <ChevronRight size={20} />
        </button>
      </nav>
    </>
  );
}
