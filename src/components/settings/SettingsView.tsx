import type React from 'react';
import { useEffect } from 'react';
import { ArrowLeft, Info, Keyboard, Link2, Monitor, Settings } from 'lucide-react';
import { t } from '../../lib/i18n';
import { AboutSettings, useProbedCodecSupport } from './AboutSettings';
import { DisplaySettings } from './DisplaySettings';
import { GeneralSettings } from './GeneralSettings';
import { InputSettings } from './InputSettings';
import { NetworkSettings } from './NetworkSettings';
import type { SettingsSection, SettingsViewProps } from './types';

export type { SettingsSection } from './types';

export function SettingsView(props: SettingsViewProps) {
  const { locale, section, modalOpen = false, onChangeSection, onOpenServerDialog, onBack } = props;
  const codecSupport = useProbedCodecSupport();

  useEffect(() => {
    if (modalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.isComposing) return;
      if (document.querySelector('dialog[open], [role="listbox"]')) return;
      const active = document.activeElement;
      if (
        active instanceof HTMLInputElement ||
        active instanceof HTMLTextAreaElement ||
        active instanceof HTMLSelectElement
      ) {
        return;
      }
      event.preventDefault();
      onBack();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [modalOpen, onBack]);

  const navItems: ReadonlyArray<{
    id: SettingsSection;
    label: string;
    icon: React.ReactNode;
  }> = [
    { id: 'general', label: t(locale, 'settingsGeneral'), icon: <Settings size={17} className="shrink-0" /> },
    { id: 'network', label: t(locale, 'settingsNetwork'), icon: <Link2 size={17} className="shrink-0" /> },
    { id: 'display', label: t(locale, 'settingsDisplay'), icon: <Monitor size={17} className="shrink-0" /> },
    { id: 'input', label: t(locale, 'settingsInput'), icon: <Keyboard size={17} className="shrink-0" /> },
    { id: 'about', label: t(locale, 'settingsAbout'), icon: <Info size={17} className="shrink-0" /> },
  ];

  const activeNav = navItems.find((item) => item.id === section) ?? navItems[0];

  return (
    <div
      className="rd-mobile-shell rd-settings-desktop"
      data-testid="connection-panel"
      onPointerDown={(e) => e.stopPropagation()}
    >
      <aside className="rd-settings-sidebar" data-testid="settings-sidebar">
        <div className="rd-settings-sidebar-header">
          <button
            type="button"
            className="rd-mobile-icon-btn dark rd-settings-back-btn"
            data-testid="mobile-settings-back"
            aria-label={t(locale, 'back')}
            data-tooltip={t(locale, 'back')}
            data-tooltip-pos="bottom-start"
            onClick={onBack}
          >
            <ArrowLeft size={20} />
          </button>
          <h1 className="rd-settings-sidebar-title">{t(locale, 'tabSettings')}</h1>
        </div>

        <nav className="flex flex-col py-2" aria-label={t(locale, 'tabSettings')}>
          {navItems.map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={`settings-tab-${item.id}`}
              aria-current={section === item.id ? 'page' : undefined}
              className={`rd-sidebar-item${section === item.id ? ' active' : ''}`}
              onClick={() => onChangeSection(item.id)}
            >
              {item.icon}
              <span className="truncate">{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      <main className="rd-settings-main" key={section}>
        <div className="rd-settings-content-inner">
          <h2 className="rd-settings-section-heading">{activeNav.label}</h2>

          {section === 'general' && (
            <GeneralSettings
              locale={props.locale}
              localePreference={props.localePreference}
              theme={props.theme}
              savedPasswordCount={props.savedPasswordCount}
              onChangeTheme={props.onChangeTheme}
              onChangeLocale={props.onChangeLocale}
              onClearAllSavedPasswords={props.onClearAllSavedPasswords}
              onResetDefaults={props.onResetDefaults}
            />
          )}

          {section === 'network' && (
            <NetworkSettings
              locale={props.locale}
              idServer={props.idServer}
              relayServer={props.relayServer}
              serverKey={props.serverKey}
              forceRelay={props.forceRelay}
              directIpEnabled={props.directIpEnabled}
              webRtcOptIn={props.webRtcOptIn}
              gatewayToken={props.gatewayToken}
              gatewayTokenReadFailed={props.gatewayTokenReadFailed}
              onSaveGatewayToken={props.onSaveGatewayToken}
              onOpenServerDialog={onOpenServerDialog}
              onToggleDirectIp={props.onToggleDirectIp}
              onChangeWebRtcOptIn={props.onChangeWebRtcOptIn}
            />
          )}

          {section === 'display' && (
            <DisplaySettings
              locale={props.locale}
              displayPrefs={props.displayPrefs}
              touchMode={props.touchMode}
              diagnosticsOpen={props.diagnosticsOpen}
              codecSupport={codecSupport}
              onUpdateDisplayPrefs={props.onUpdateDisplayPrefs}
              onToggleTouchMode={props.onToggleTouchMode}
              onToggleDiagnostics={props.onToggleDiagnostics}
            />
          )}

          {section === 'input' && (
            <InputSettings
              locale={props.locale}
              displayPrefs={props.displayPrefs}
              touchMode={props.touchMode}
              onUpdateDisplayPrefs={props.onUpdateDisplayPrefs}
              onToggleTouchMode={props.onToggleTouchMode}
            />
          )}

          {section === 'about' && (
            <AboutSettings locale={props.locale} codecSupport={codecSupport} />
          )}
        </div>
      </main>
    </div>
  );
}

