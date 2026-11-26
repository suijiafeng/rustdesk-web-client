import type { DisplayPrefs } from '../../lib/displayPrefs';
import type { Locale, LocalePreference } from '../../lib/i18n';
import type { ThemePreference } from '../../lib/theme';

export type SettingsSection = 'general' | 'network' | 'display' | 'about';

export interface SettingsViewProps {
  locale: Locale;
  localePreference: LocalePreference;
  theme: ThemePreference;
  displayPrefs: DisplayPrefs;
  section: SettingsSection;
  directIpEnabled: boolean;
  webRtcOptIn: boolean;
  idServer: string;
  gatewayToken: string;
  gatewayTokenReadFailed: boolean;
  onSaveGatewayToken: (value: string) => Promise<boolean>;
  touchMode: boolean;
  diagnosticsOpen: boolean;
  onChangeSection: (next: SettingsSection) => void;
  onChangeLocale: (next: LocalePreference) => void;
  onChangeTheme: (next: ThemePreference) => void;
  onUpdateDisplayPrefs: (patch: Partial<DisplayPrefs>) => void;
  onToggleDirectIp: () => void;
  onChangeWebRtcOptIn: (checked: boolean) => void;
  onToggleTouchMode: () => void;
  onToggleDiagnostics: () => void;
  onOpenServerDialog: () => void;
  onBack: () => void;
}

