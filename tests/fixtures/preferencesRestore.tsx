import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { usePreferences } from '../../src/hooks/usePreferences';
import { GeneralSettings } from '../../src/components/settings/GeneralSettings';
import { DisplaySettings } from '../../src/components/settings/DisplaySettings';
import { persistDisplayPrefs, type DisplayPrefs } from '../../src/lib/displayPrefs';

const result = { status: 'running', violations: [] as string[] };
Object.assign(window, { preferencesResult: result });
document.addEventListener('securitypolicyviolation', event => result.violations.push(event.violatedDirective));
const mount = document.createElement('main');
document.body.append(mount);

function Fixture() {
  const prefs = usePreferences(navigator.maxTouchPoints > 0);
  const updateDisplay = (patch: Partial<DisplayPrefs>) => prefs.setDisplayPrefs(previous => {
    const next = { ...previous, ...patch };
    persistDisplayPrefs(next);
    return next;
  });
  Object.assign(window, { preferencesFixture: {
    snapshot: () => ({ touchMode: prefs.touchMode, display: prefs.displayPrefs }),
    updateDisplay,
  } });
  useEffect(() => { result.status = 'passed'; }, []);
  return <>
    <GeneralSettings locale="en" localePreference="en" theme={prefs.theme} touchMode={prefs.touchMode}
      onChangeTheme={prefs.changeTheme} onChangeLocale={prefs.changeLocale}
      onToggleTouchMode={() => prefs.setTouchMode(previous => !previous)} />
    <DisplaySettings locale="en" displayPrefs={prefs.displayPrefs} diagnosticsOpen={false}
      onUpdateDisplayPrefs={updateDisplay} onToggleDiagnostics={() => {}} />
  </>;
}
createRoot(mount).render(<Fixture />);
