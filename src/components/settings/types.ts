import type { DisplayPrefs } from '../../lib/displayPrefs';
import type { Locale, LocalePreference } from '../../lib/i18n';
import type { ThemePreference } from '../../lib/theme';
import type { ServerField } from './IdServerModal';

export type SettingsSection = 'general' | 'network' | 'display' | 'about';

export interface SettingsViewProps {
  locale: Locale;
  localePreference: LocalePreference;
  theme: ThemePreference;
  displayPrefs: DisplayPrefs;
  section: SettingsSection;
  directIpEnabled: boolean;
  idServer: string;
  relayServer: string;
  serverKey: string;
  forceRelay: boolean;
  gatewayToken: string;
  gatewayTokenReadFailed: boolean;
  onSaveGatewayToken: (value: string) => Promise<boolean>;
  touchMode: boolean;
  diagnosticsOpen: boolean;
  serverDialogOpen: boolean;
  idServerError: boolean;
  onChangeSection: (next: SettingsSection) => void;
  onChangeLocale: (next: LocalePreference) => void;
  onChangeTheme: (next: ThemePreference) => void;
  onUpdateDisplayPrefs: (patch: Partial<DisplayPrefs>) => void;
  onToggleDirectIp: () => void;
  onToggleTouchMode: () => void;
  onToggleDiagnostics: () => void;
  onChangeServerField: (field: ServerField, value: string) => void;
  onChangeForceRelay: (checked: boolean) => void;
  onSetServerDialogOpen: (open: boolean) => void;
  onClearIdServerError: () => void;
  onBack: () => void;
}

