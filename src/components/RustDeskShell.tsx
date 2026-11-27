import type { ErrorPayload } from '../../shared/errors';
import { lazy, Suspense, useMemo, useState } from 'react';
import {
  Clock,
  LayoutGrid,
  List,
  Settings,
  Star,
  X,
} from 'lucide-react';
import type { SavedDevice } from '../lib/devices';
import type { DisplayPrefs } from '../lib/displayPrefs';
import { t, type Locale, type LocalePreference } from '../lib/i18n';
import type { SavedPasswordMap } from '../lib/passwords';
import type { ThemePreference } from '../lib/theme';
import type { ConnectionField, ConnectionMode, ConnectionPhase, ConnectRequest } from '../types';
import { ConnectForm, ConnectPasswordPrompt, useConnectForm } from './ConnectForm';

import { PeerList } from './PeerList';
import type { SettingsSection } from './settings/SettingsView';

const SettingsView = lazy(() =>
  import('./settings/SettingsView').then((m) => ({ default: m.SettingsView }))
);
const IdServerModal = lazy(() =>
  import('./settings/IdServerModal').then((m) => ({ default: m.IdServerModal }))
);

export type { ConnectionField, ConnectionMode, ConnectionPhase, ConnectRequest } from '../types';

type ListTab = 'recent' | 'favorites';

interface RustDeskShellProps {
  locale: Locale;
  localePreference: LocalePreference;
  isDesktop: boolean;
  theme: ThemePreference;
  displayPrefs: DisplayPrefs;
  onChangeLocale: (next: LocalePreference) => void;
  onChangeTheme: (next: ThemePreference) => void;
  onUpdateDisplayPrefs: (patch: Partial<DisplayPrefs>) => void;
  mode: ConnectionMode;
  directIpEnabled: boolean;
  webRtcOptIn: boolean;
  phase: ConnectionPhase;
  host: string;
  port: string;
  password: string;
  peerId: string;
  idServer: string;
  relayServer: string;
  serverKey: string;
  forceRelay: boolean;
  gatewayToken: string;
  savedGatewayToken: string;
  gatewayTokenNeedsInput: boolean;
  gatewayTokenReadFailed: boolean;
  onSaveGatewayToken: (value: string) => Promise<boolean>;
  detail: string;
  connectionError?: ErrorPayload;
  decoderError: string;
  touchMode: boolean;
  diagnosticsOpen: boolean;
  devices: SavedDevice[];
  savedPasswords: SavedPasswordMap;
  onChangeMode: (mode: ConnectionMode) => void;
  onToggleDirectIp: () => void;
  onChangeWebRtcOptIn: (checked: boolean) => void;
  onChangeField: (field: ConnectionField, value: string) => void;
  onChangeForceRelay: (checked: boolean) => void;
  onClearSavedPassword: (deviceKey: string) => void;
  onClearAllSavedPasswords?: () => void;
  onResetDefaults?: () => void;
  onSelectDevice: (device: SavedDevice) => void;
  onToggleFavorite: (key: string) => void;
  onRenameDevice?: (key: string, alias: string) => void;
  onRemoveDevice: (key: string) => void;
  onToggleTouchMode: () => void;
  onToggleDiagnostics: () => void;
  onConnect: (req?: ConnectRequest) => void;
  onDisconnect: () => void;
  onDismissError: () => void;
  onClose: () => void;
}

export function RustDeskShell({
  locale,
  localePreference,
  isDesktop,
  theme,
  displayPrefs,
  onChangeLocale,
  onChangeTheme,
  onUpdateDisplayPrefs,
  mode,
  directIpEnabled,
  webRtcOptIn,
  phase,
  host,
  port,
  password,
  peerId,
  idServer,
  relayServer,
  serverKey,
  forceRelay,
  gatewayToken,
  savedGatewayToken,
  gatewayTokenNeedsInput,
  gatewayTokenReadFailed,
  onSaveGatewayToken,
  detail,
  connectionError,
  decoderError,
  touchMode,
  diagnosticsOpen,
  devices,
  savedPasswords,
  onChangeMode,
  onToggleDirectIp,
  onChangeWebRtcOptIn,
  onChangeField,
  onChangeForceRelay,
  onClearSavedPassword,
  onClearAllSavedPasswords,
  onResetDefaults,
  onSelectDevice,
  onToggleFavorite,
  onRenameDevice,
  onRemoveDevice,
  onToggleTouchMode,
  onToggleDiagnostics,
  onConnect,
  onDisconnect,
  onDismissError,
  onClose,
}: RustDeskShellProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('general');
  const [serverDialogOpen, setServerDialogOpen] = useState(false);
  const [connectAfterServerSetup, setConnectAfterServerSetup] = useState(false);

  const [listTab, setListTab] = useState<ListTab>('recent');
  const [viewLayout, setViewLayout] = useState<'grid' | 'list'>(() => {
    try {
      const saved = window.localStorage.getItem('rd_web_home_layout');
      if (saved === 'grid' || saved === 'list') return saved;
    } catch {
      // Ignore storage access errors
    }
    return isDesktop ? 'grid' : 'list';
  });
  const isLive = phase === 'live';
  const effectiveLayout = isDesktop ? viewLayout : 'list';

  const filteredDevices = useMemo(
    () => (listTab === 'favorites' ? devices.filter((d) => d.favorite) : devices),
    [devices, listTab],
  );

  const openNetworkServerSetup = (continueConnection = false) => {
    setConnectAfterServerSetup(continueConnection);
    setServerDialogOpen(true);
  };

  const connectForm = useConnectForm({
    locale,
    mode,
    directIpEnabled,
    phase,
    host,
    port,
    password,
    peerId,
    idServer,
    relayServer,
    serverKey,
    forceRelay,
    gatewayToken,
    gatewayTokenNeedsInput,
    detail,
    connectionError,
    decoderError,
    devices,
    savedPasswords,
    onChangeMode,
    onChangeField,
    onClearSavedPassword,
    onSelectDevice,
    onConnect,
    onDisconnect,
    onDismissError,
    openNetworkServerSetup,
  });

  const closeServerDialog = () => {
    setServerDialogOpen(false);
    setConnectAfterServerSetup(false);
    connectForm.cancelServerSetup();
  };
  const serverDialog = serverDialogOpen && (
    <Suspense fallback={null}>
      <IdServerModal
        locale={locale}
        idServer={idServer}
        relayServer={relayServer}
        serverKey={serverKey}
        forceRelay={forceRelay}
        connectionSetup={connectAfterServerSetup}
        onChangeField={onChangeField}
        onChangeForceRelay={onChangeForceRelay}
        onClose={closeServerDialog}
        onSave={settings => {
          setServerDialogOpen(false);
          setConnectAfterServerSetup(false);
          if (connectAfterServerSetup) connectForm.continueAfterServerSetup(settings);
        }}
      />
    </Suspense>
  );

  if (settingsOpen) {
    return (
      <>
      <Suspense fallback={<div className="rd-mobile-shell" aria-hidden="true" />}>
        <SettingsView
          locale={locale}
          localePreference={localePreference}
          theme={theme}
          displayPrefs={displayPrefs}
          section={settingsSection}
          directIpEnabled={directIpEnabled}
          webRtcOptIn={webRtcOptIn}
          idServer={idServer}
          relayServer={relayServer}
          serverKey={serverKey}
          forceRelay={forceRelay}
          gatewayToken={savedGatewayToken}
          gatewayTokenReadFailed={gatewayTokenReadFailed}
          onSaveGatewayToken={onSaveGatewayToken}
          touchMode={touchMode}
          diagnosticsOpen={diagnosticsOpen}
          savedPasswordCount={Object.keys(savedPasswords).length}
          modalOpen={serverDialogOpen}
          onChangeSection={setSettingsSection}
          onChangeLocale={onChangeLocale}
          onChangeTheme={onChangeTheme}
          onUpdateDisplayPrefs={onUpdateDisplayPrefs}
          onToggleDirectIp={onToggleDirectIp}
          onChangeWebRtcOptIn={onChangeWebRtcOptIn}
          onToggleTouchMode={onToggleTouchMode}
          onToggleDiagnostics={onToggleDiagnostics}
          onOpenServerDialog={() => openNetworkServerSetup()}
          onClearAllSavedPasswords={onClearAllSavedPasswords}
          onResetDefaults={onResetDefaults}
          onBack={() => {
            closeServerDialog();
            setSettingsOpen(false);
          }}
        />
      </Suspense>
      {serverDialog}
      </>
    );
  }

  return (
    <div
      className="rd-mobile-shell"
      data-testid="connection-panel"
      onPointerDown={(e) => e.stopPropagation()}
    >
        <header className="rd-mobile-topbar" data-testid="main-topbar">
          <div className="w-16 flex items-center justify-start">
            {isLive && (
              <button
                type="button"
                className="rd-mobile-icon-btn"
                aria-label={t(locale, 'close')}
                data-tooltip={t(locale, 'close')}
                data-tooltip-pos="bottom-start"
                onClick={onClose}
              >
                <X size={20} />
              </button>
            )}
          </div>

          <h1 className="text-[18px] font-semibold text-[var(--rd-topbar-ink)] m-0 tracking-[0.01em] truncate">
            RustDesk Web
          </h1>

          <div className="w-16 flex items-center justify-end gap-0.5">
            <button
              type="button"
              className="rd-mobile-icon-btn"
              data-testid="mobile-open-settings"
              aria-label={t(locale, 'openSettings')}
              data-tooltip={t(locale, 'tabSettings')}
              data-tooltip-pos="bottom-end"
              onClick={() => setSettingsOpen(true)}
            >
              <Settings size={20} />
            </button>
          </div>
        </header>

      <main className="rd-mobile-scroll rd-mobile-home-body">
        <ConnectForm model={connectForm} />

        <div className="rd-home-content">
          {/* Sub-Tab Bar */}
          <div className="rd-subtab-bar" data-testid="home-subtab-bar">
            <div className="flex items-center gap-1" role="tablist" aria-label={t(locale, 'recentSessions')}>
              <button
                type="button"
                role="tab"
                aria-selected={listTab === 'recent'}
                aria-label={t(locale, 'recentSessions')}
                data-testid="mobile-subtab-recent"
                className={`rd-subtab-btn${listTab === 'recent' ? ' active' : ''}`}
                onClick={() => setListTab('recent')}
              >
                <Clock size={17} />
                <span>{t(locale, 'recentSessions')}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={listTab === 'favorites'}
                aria-label={t(locale, 'tabFavorites')}
                data-testid="mobile-subtab-favorites"
                className={`rd-subtab-btn${listTab === 'favorites' ? ' active' : ''}`}
                onClick={() => setListTab('favorites')}
              >
                <Star size={17} />
                <span>{t(locale, 'tabFavorites')}</span>
              </button>
            </div>

            {isDesktop && (
              <div className="flex items-center gap-0.5">
                <button
                  type="button"
                  className="rd-subtab-btn"
                  data-testid="toggle-device-layout"
                  aria-label={
                    viewLayout === 'grid' ? t(locale, 'listViewAria') : t(locale, 'gridViewAria')
                  }
                  data-tooltip={
                    viewLayout === 'grid' ? t(locale, 'listViewAria') : t(locale, 'gridViewAria')
                  }
                  data-tooltip-pos="bottom-end"
                  onClick={() =>
                    setViewLayout((prev) => {
                      const next = prev === 'grid' ? 'list' : 'grid';
                      try {
                        window.localStorage.setItem('rd_web_home_layout', next);
                      } catch {
                        // Ignore storage quota errors
                      }
                      return next;
                    })
                  }
                >
                  {viewLayout === 'grid' ? <LayoutGrid size={18} /> : <List size={18} />}
                </button>
              </div>
            )}
          </div>

          {/* Peer Cards Grid / List */}
          <section className="flex-1 flex flex-col px-4 md:px-0 py-4">
            <PeerList
              locale={locale}
              devices={filteredDevices}
              savedPasswords={savedPasswords}
              listTab={listTab}
              searchQuery=""
              layout={effectiveLayout}
              onSelect={connectForm.handleDeviceRowTap}
              onToggleFavorite={onToggleFavorite}
              onRename={onRenameDevice}
              onClearSavedPassword={onClearSavedPassword}
              onRemove={onRemoveDevice}
            />
          </section>
        </div>
      </main>

      <ConnectPasswordPrompt model={connectForm} />
      {serverDialog}
    </div>
  );
}
