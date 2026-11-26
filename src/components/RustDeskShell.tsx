import type { ErrorPayload } from '../../shared/errors';
import { useMemo, useState } from 'react';
import {
  Clock,
  LayoutGrid,
  List,
  Search,
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
import { SettingsView, type SettingsSection } from './settings/SettingsView';
import { IdServerModal } from './settings/IdServerModal';

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
  const [viewLayout, setViewLayout] = useState<'grid' | 'list'>(isDesktop ? 'grid' : 'list');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const isLive = phase === 'live';
  const effectiveLayout = isDesktop ? viewLayout : 'list';

  const filteredDevices = useMemo(() => {
    const base = listTab === 'favorites' ? devices.filter((d) => d.favorite) : devices;
    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    const compactQ = q.replace(/\s+/g, '');
    return base.filter((d) => {
      return (
        (d.peerId ?? '').toLowerCase().includes(compactQ) ||
        (d.host ?? '').toLowerCase().includes(q) ||
        (d.hostname ?? '').toLowerCase().includes(q) ||
        (d.platform ?? '').toLowerCase().includes(q)
      );
    });
  }, [devices, listTab, searchQuery]);

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
  );

  if (settingsOpen) {
    return (
      <>
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
      {serverDialog}
      </>
    );
  }

  const trimmedIdServer = idServer.trim();

  return (
    <div
      className="rd-mobile-shell"
      data-testid="connection-panel"
      onPointerDown={(e) => e.stopPropagation()}
    >
        <header className="rd-mobile-topbar" data-testid="main-topbar">
          <div className="flex items-center gap-1.5 min-w-0">
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
            <h1 className="text-[17px] font-semibold text-[var(--rd-topbar-ink)] m-0 tracking-[0.01em] truncate pl-1.5">
              RustDesk Web
            </h1>
          </div>

          <div className="flex items-center justify-end gap-1.5 shrink-0">
            <button
              type="button"
              className={`rd-topbar-server-btn${trimmedIdServer ? ' configured' : ''}`}
              data-testid="topbar-server-status"
              aria-label={t(locale, 'idRelayServerTitle')}
              data-tooltip={t(locale, 'idRelayServerTitle')}
              data-tooltip-pos="bottom-end"
              onClick={() => openNetworkServerSetup(false)}
            >
              <span className="rd-topbar-dot" aria-hidden="true" />
              <span className={`truncate${trimmedIdServer ? ' font-mono-tabular' : ''}`}>
                {trimmedIdServer || t(locale, 'serverUnconfiguredShort')}
              </span>
            </button>

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
                data-tooltip={t(locale, 'recentSessions')}
                data-tooltip-pos="bottom-start"
                data-testid="mobile-subtab-recent"
                className={`rd-subtab-btn${listTab === 'recent' ? ' active' : ''}`}
                onClick={() => setListTab('recent')}
              >
                <Clock size={18} />
                <span className="hidden sm:inline">{t(locale, 'recentSessions')}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={listTab === 'favorites'}
                aria-label={t(locale, 'tabFavorites')}
                data-tooltip={t(locale, 'tabFavorites')}
                data-tooltip-pos="bottom"
                data-testid="mobile-subtab-favorites"
                className={`rd-subtab-btn${listTab === 'favorites' ? ' active' : ''}`}
                onClick={() => setListTab('favorites')}
              >
                <Star size={18} />
                <span className="hidden sm:inline">{t(locale, 'tabFavorites')}</span>
              </button>
            </div>

            <div className="flex items-center gap-0.5">
              <button
                type="button"
                className={`rd-subtab-btn${searchOpen ? ' active' : ''}`}
                aria-label={t(locale, 'searchDevicesAria')}
                aria-expanded={searchOpen}
                data-tooltip={t(locale, 'searchDevicesAria')}
                data-tooltip-pos="bottom-end"
                data-testid="mobile-search-toggle"
                onClick={() => {
                  setSearchOpen((prev) => {
                    if (prev) setSearchQuery('');
                    return !prev;
                  });
                }}
              >
                <Search size={18} />
              </button>

              {isDesktop && (
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
                  onClick={() => setViewLayout((prev) => (prev === 'grid' ? 'list' : 'grid'))}
                >
                  {viewLayout === 'grid' ? <LayoutGrid size={18} /> : <List size={18} />}
                </button>
              )}
            </div>
          </div>

          {/* Inline Search Bar */}
          {searchOpen && (
            <div className="px-4 md:px-0 pt-3 pb-1">
              <div className="rd-search-bar">
                <Search size={16} className="text-[var(--ink-soft)] shrink-0" />
                <input
                  type="text"
                  className="w-full bg-transparent border-0 outline-none text-sm text-[var(--ink)]"
                  data-testid="mobile-search-input"
                  value={searchQuery}
                  placeholder={t(locale, 'searchDevicesPlaceholder')}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="inline-flex items-center justify-center w-8 h-8 border-0 bg-transparent text-[var(--ink-soft)]"
                    aria-label={t(locale, 'clearInput')}
                    data-tooltip={t(locale, 'clearInput')}
                    data-tooltip-pos="top-end"
                    onClick={() => setSearchQuery('')}
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Peer Cards Grid / List */}
          <section className="flex-1 flex flex-col px-4 md:px-0 py-4">
            <PeerList
              locale={locale}
              devices={filteredDevices}
              listTab={listTab}
              searchQuery={searchQuery}
              layout={effectiveLayout}
              onSelect={connectForm.handleDeviceRowTap}
              onToggleFavorite={onToggleFavorite}
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
