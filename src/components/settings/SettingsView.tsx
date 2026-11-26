import type React from 'react';
import { ArrowLeft, Info, Link2, Monitor, Settings } from 'lucide-react';
import { t } from '../../lib/i18n';
import { AboutSettings, useDetectedCodecs } from './AboutSettings';
import { DisplaySettings } from './DisplaySettings';
import { GeneralSettings } from './GeneralSettings';
import { IdServerModal } from './IdServerModal';
import { NetworkSettings } from './NetworkSettings';
import type { SettingsSection, SettingsViewProps } from './types';

export type { SettingsSection } from './types';

export function SettingsView(props: SettingsViewProps) {
  const { locale, section, serverDialogOpen, onChangeSection, onSetServerDialogOpen, onBack } =
    props;
  const detectedCodecs = useDetectedCodecs();

  const navItems: ReadonlyArray<{
    id: SettingsSection;
    label: string;
    icon: React.ReactNode;
  }> = [
    { id: 'general', label: t(locale, 'settingsGeneral'), icon: <Settings size={17} className="shrink-0" /> },
    { id: 'network', label: t(locale, 'settingsNetwork'), icon: <Link2 size={17} className="shrink-0" /> },
    { id: 'display', label: t(locale, 'settingsDisplay'), icon: <Monitor size={17} className="shrink-0" /> },
    { id: 'about', label: t(locale, 'settingsAbout'), icon: <Info size={17} className="shrink-0" /> },
  ];

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
          {section === 'general' && (
            <GeneralSettings
              locale={props.locale}
              localePreference={props.localePreference}
              theme={props.theme}
              diagnosticsOpen={props.diagnosticsOpen}
              touchMode={props.touchMode}
              onChangeTheme={props.onChangeTheme}
              onChangeLocale={props.onChangeLocale}
              onToggleDiagnostics={props.onToggleDiagnostics}
              onToggleTouchMode={props.onToggleTouchMode}
            />
          )}

          {section === 'network' && (
            <NetworkSettings
              locale={props.locale}
              idServer={props.idServer}
              directIpEnabled={props.directIpEnabled}
              webRtcOptIn={props.webRtcOptIn}
              gatewayToken={props.gatewayToken}
              gatewayTokenReadFailed={props.gatewayTokenReadFailed}
              onSaveGatewayToken={props.onSaveGatewayToken}
              onOpenServerDialog={() => onSetServerDialogOpen(true)}
              onToggleDirectIp={props.onToggleDirectIp}
              onChangeWebRtcOptIn={props.onChangeWebRtcOptIn}
            />
          )}

          {section === 'display' && (
            <DisplaySettings
              locale={props.locale}
              displayPrefs={props.displayPrefs}
              diagnosticsOpen={props.diagnosticsOpen}
              onUpdateDisplayPrefs={props.onUpdateDisplayPrefs}
              onToggleDiagnostics={props.onToggleDiagnostics}
            />
          )}

          {section === 'about' && (
            <AboutSettings locale={props.locale} detectedCodecs={detectedCodecs} />
          )}
        </div>
      </main>

      {serverDialogOpen && (
        <IdServerModal
          locale={props.locale}
          idServer={props.idServer}
          relayServer={props.relayServer}
          serverKey={props.serverKey}
          forceRelay={props.forceRelay}
          idServerError={props.idServerError}
          onChangeField={props.onChangeServerField}
          onChangeForceRelay={props.onChangeForceRelay}
          onClearError={props.onClearIdServerError}
          onClose={() => onSetServerDialogOpen(false)}
        />
      )}
    </div>
  );
}
