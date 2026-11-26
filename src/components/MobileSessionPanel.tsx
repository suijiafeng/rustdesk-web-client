import React from 'react';
import { RestartAction } from './RestartAction';
import { AdaptiveSelect } from './AdaptiveSelect';
import { ScrollDirectionSelect } from './ScrollDirectionSelect';
import { ArrowDownUp, ChevronLeft, CircleHelp, Clipboard, Shield, Activity, Eye, Focus, LockKeyhole, LogOut, Monitor, SlidersHorizontal, Volume2, Gauge, Film } from 'lucide-react';
import { t, type I18nKey } from '../lib/i18n';
import { formatConnectionError } from '../lib/errors';
import type { SessionMenuProps } from './SessionMenu';
import type { PreferredCodec } from '../lib/displayPrefs';
import type { QualityLevel } from '../lib/protocol';
const qualityNames = { low: 'qualityLow', balanced: 'qualityBalanced', best: 'qualityBest' } as const;

export type MobilePanel = 'toolbar' | 'actions' | 'display' | 'more' | 'gestures';

export interface MobileSessionPanelProps extends SessionMenuProps {
  mobilePanel: MobilePanel;
  onNavigate: (panel: 'more' | 'gestures') => void;
}

const gestureRows = {
  touch: [
    ['gTouchTapTitle', 'gTouchTapDesc'],
    ['gDoubleTapTitle', 'gTouchDoubleTapDesc'],
    ['gTouchRightTitle', 'gTouchRightDesc'],
    ['gTouchDragTitle', 'gTouchDragDesc'],
    ['gTouchPinchTitle', 'gTouchPinchDesc'],
    ['gTouchScrollTitle', 'gTouchScrollDesc'],
  ],
  mouse: [
    ['gMouseSlideTitle', 'gMouseSlideDesc'],
    ['gMouseTapTitle', 'gMouseTapDesc'],
    ['gDoubleTapTitle', 'gMouseDoubleTapDesc'],
    ['gMouseDragTitle', 'gMouseDragDesc'],
    ['gMouseRightTitle', 'gMouseRightDesc'],
    ['gMousePinchTitle', 'gMousePinchDesc'],
    ['gTouchScrollTitle', 'gTouchScrollDesc'],
  ],
} as const;

export function MobileSessionPanel(p: MobileSessionPanelProps) {
  const label = (key: I18nKey) => t(p.locale, key);
  React.useEffect(() => {
    if (p.decoderError) p.onNotify(formatConnectionError(p.locale, p.decoderError).message, true);
  }, [p.decoderError, p.locale, p.onNotify]);
  const notify = (text: string) => p.onNotify(text);
  const resolutionIndex = p.sizes.findIndex(s => s.width === p.stats.width && s.height === p.stats.height);
  const monitors = p.peer?.displays ?? [];
  const panelName = { actions: 'moreActions', display: 'screens', more: 'dockMore', gestures: 'dockGuide' } as const;

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
          <label className="tool-row"><ArrowDownUp /><span>{label('scrollDirection')}</span>
            <ScrollDirectionSelect locale={p.locale} tone="remote" testId="session-reverse-scroll"
              reverse={p.reverseScroll} onChange={p.onReverseScrollChange} />
          </label>
        </div>
        <div className="tool-group">
          {p.peer?.restartAllowed && <RestartAction locale={p.locale} className="tool-row" onConfirm={p.onRestart} />}
          {action(LockKeyhole, 'lockScreen', () => p.onQuickKey('Lock'))}
          {action(LogOut, 'disconnectRemote', p.onDisconnect, true)}
        </div>
      </>}
      {p.mobilePanel === 'more' && <div className="tool-group">
        <button type="button" className="tool-row" data-testid="more-gestures" onClick={() => p.onNavigate('gestures')}>
          <CircleHelp />{label('dockGuide')}
        </button>
        <button type="button" className="tool-row" data-testid="more-connection-details" onClick={p.onToggleDiagnostics}>
          <Activity />{label('diagTitle')}
        </button>
      </div>}
      {p.mobilePanel === 'gestures' && <div className="tool-group">
        <button type="button" className="tool-row" data-testid="gestures-back" onClick={() => p.onNavigate('more')}>
          <ChevronLeft />{label('dockMore')}
        </button>
        <h2 className="text-base font-semibold my-2">{label(p.touchMode ? 'touchModeGestures' : 'mouseModeGestures')}</h2>
        <dl data-testid="gesture-guide">{gestureRows[p.touchMode ? 'touch' : 'mouse'].map(([name, desc]) =>
          <div key={name}><dt>{label(name)}</dt><dd>{label(desc)}</dd></div>)}</dl>
      </div>}
      {p.mobilePanel === 'display' && <>
        {monitors.length > 1 && <div className="tool-group tool-options">{monitors.map(d =>
          <button key={d.index} aria-pressed={d.index === p.display} disabled={d.online === false}
            onClick={() => { p.onSwitchDisplay(d.index); notify(label('requestSent')+' · '+(d.name || label('screens')+' '+(d.index+1))); }}><Monitor />{d.name || label('screens')+' '+(d.index+1)}</button>)}</div>}
        <div className="tool-group">
          {p.peer?.privacyAllowed && toggle(Shield, 'privacyMode', p.privacyEnabled, p.onTogglePrivacy, p.privacyPending || p.viewOnly)}
          {p.sizes.length > 0 && <label className="tool-row"><Monitor /><span>{label('remoteResolution')}</span>
            <AdaptiveSelect tone="remote" label={label('remoteResolution')} testId="resolution-select" disabled={p.viewOnly}
              value={String(resolutionIndex)}
              options={[...(resolutionIndex < 0 ? [{ value: '-1', label: `${p.stats.width} × ${p.stats.height}`, disabled: true }] : []), ...p.sizes.map((s,i) => ({ value: String(i), label: `${s.width} × ${s.height}` }))]}
              onChange={value => { const size = p.sizes[Number(value)]; if (size) { p.onResolution(size.width,size.height); notify(label('requestSent')+' · '+size.width+' × '+size.height); } }} />
            </label>}
          <div data-testid="mobile-quality">
            <label className="tool-row"><SlidersHorizontal /><span>{label('qualityAndFps')}</span>
              <AdaptiveSelect tone="remote" label={label('qualityAndFps')} testId="quality-select" value={p.quality}
                options={(['low', 'balanced', 'best'] as const).map(level => ({ value: level, label: label(qualityNames[level]) }))}
                onChange={value => {
                const level = value as QualityLevel;
                p.onChangeQuality(level, p.targetFps);
                notify(label('requestSent')+' · '+label(qualityNames[level]));
              }} />
            </label>
            <label className="tool-row"><Gauge /><span>{label('targetFps')}</span>
              <AdaptiveSelect tone="remote" label={label('targetFps')} testId="fps-select" value={String(p.targetFps)}
                options={[...new Set([15,30,60,p.targetFps])].sort((a,b) => a-b).map(n => ({ value: String(n), label: `${n} FPS` }))}
                onChange={value => { p.onChangeQuality(p.quality, Number(value)); notify(label('requestSent')+' · '+value+' FPS'); }} /></label>
            <label className="tool-row"><Film /><span>{label('sessionCodecLabel')}</span>
              <AdaptiveSelect tone="remote" label={label('sessionCodecLabel')} testId="codec-select" value={p.preferredCodec}
                options={['auto','h264','vp8','vp9','av1'].map(value => ({ value, label: value==='auto'?label('codecAuto'):value === 'h264' ? 'H.264' : value.toUpperCase() }))}
                onChange={value => { p.onChangeQuality(p.quality,p.targetFps,value as PreferredCodec); notify(label('requestSent')+' · '+(value === 'auto' ? label('codecAuto') : value === 'h264' ? 'H.264' : value.toUpperCase())); }} /></label>
          </div>
        </div>
        {monitors.length > 1 && <div className="tool-group">
          {toggle(Focus,'followWindow',p.followWindow,() => { p.onToggleFollowWindow(); notify(label('followWindow')+' · '+label(p.followWindow ? 'optionOff' : 'optionOn')); })}
        </div>}
      </>}
    </section>
  );
}
