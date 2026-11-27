import React, { useState } from 'react';
import { ConfirmDialog, RestartAction } from './RestartAction';
import { SessionDisplayControls } from './SessionDisplayControls';
import { Clipboard, Eye, LockKeyhole, LogOut, Volume2 } from 'lucide-react';
import { t, type I18nKey } from '../lib/i18n';
import { formatConnectionError } from '../lib/errors';
import type { SessionMenuProps } from './SessionMenu';

export type MobilePanel = 'toolbar' | 'actions' | 'display';

export interface MobileSessionPanelProps extends SessionMenuProps {
  mobilePanel: MobilePanel;
}

export function MobileSessionPanel(p: MobileSessionPanelProps) {
  const [pendingConfirm, setPendingConfirm] = useState<'lock' | 'disconnect' | null>(null);
  const label = (key: I18nKey) => t(p.locale, key);
  React.useEffect(() => {
    if (p.decoderError) p.onNotify(formatConnectionError(p.locale, p.decoderError).message, true);
  }, [p.decoderError, p.locale, p.onNotify]);
  const panelName = { actions: 'moreActions', display: 'screens' } as const;

  const toggle = (Icon: typeof Eye, text: I18nKey, checked: boolean, change: () => void, disabled = false) => (
    <label className="tool-row"><Icon /><span>{label(text)}</span>
      <input className="ui-switch" type="checkbox" role="switch" checked={checked} onChange={change} disabled={disabled} />
    </label>
  );
  const action = (Icon: typeof Eye, text: I18nKey, run: () => void, danger = false) => (
    <button type="button" className={danger ? 'tool-row destructive' : 'tool-row'} onClick={run}><Icon />{label(text)}</button>
  );
  if (p.mobilePanel === 'toolbar') return null;

  return (
    <section className="remote-menu-panel" role="dialog" aria-label={label(panelName[p.mobilePanel])} data-testid="session-menu"
      onPointerDown={e => e.stopPropagation()}>
      {p.mobilePanel === 'actions' && <>
        <div className="tool-group">
          {toggle(Volume2, 'remoteAudio', p.audioEnabled, p.onToggleAudio)}
          {toggle(Clipboard, 'clipSync', p.clipboardSync, p.onToggleClipboardSync, !p.clipboardAllowed)}
        </div>
        <div className="tool-group">
          {p.peer?.restartAllowed && <RestartAction locale={p.locale} className="tool-row" onConfirm={p.onRestart} />}
          {action(LockKeyhole, 'lockScreen', () => setPendingConfirm('lock'))}
          {action(LogOut, 'disconnectRemote', () => setPendingConfirm('disconnect'), true)}
        </div>
        <ConfirmDialog
          open={pendingConfirm !== null}
          locale={p.locale}
          title={label(pendingConfirm === 'lock' ? 'lockScreen' : 'disconnectRemote')}
          description={label(pendingConfirm === 'lock' ? 'confirmLock' : 'confirmDisconnect')}
          confirmLabel={label(pendingConfirm === 'lock' ? 'lockScreen' : 'disconnectRemote')}
          onClose={() => setPendingConfirm(null)}
          onConfirm={() => {
            if (pendingConfirm === 'lock') p.onQuickKey('Lock');
            else if (pendingConfirm === 'disconnect') p.onDisconnect();
          }}
        />
      </>}
      {p.mobilePanel === 'display' && (
        <SessionDisplayControls
          variant="mobile"
          locale={p.locale}
          peer={p.peer}
          display={p.display}
          viewOnly={p.viewOnly}
          stats={p.stats}
          sizes={p.sizes}
          quality={p.quality}
          customQuality={p.customQuality}
          targetFps={p.targetFps}
          preferredCodec={p.preferredCodec}
          codecSupport={p.codecSupport}
          privacyEnabled={p.privacyEnabled}
          privacyPending={p.privacyPending}
          followWindow={p.followWindow}
          onSwitchDisplay={p.onSwitchDisplay}
          onTogglePrivacy={p.onTogglePrivacy}
          onResolution={p.onResolution}
          onChangeQuality={p.onChangeQuality}
          onToggleFollowWindow={p.onToggleFollowWindow}
          onNotify={p.onNotify}
        />
      )}
    </section>
  );
}
