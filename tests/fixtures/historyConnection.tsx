import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { RustDeskShell } from '../../src/components/RustDeskShell';
import { useSavedDevices } from '../../src/hooks/useSavedDevices';
import { DEFAULT_DISPLAY_PREFS } from '../../src/lib/displayPrefs';
import { deviceKeyFor, DEVICES_STORAGE_KEY, type SavedDevice } from '../../src/lib/devices';
import { persistDevicePassword, persistGatewayToken } from '../../src/lib/passwords';
import type { ConnectionField, ConnectionPhase, ConnectRequest } from '../../src/types';
import type { ErrorPayload } from '../../shared/errors';

const result = { status: 'running', checks: 0, error: '' };
Object.assign(window, { historyConnectionResult: result });
const check = (condition: unknown, message: string) => {
  if (!condition) throw new Error(message);
  result.checks++;
};
const settle = () => new Promise(resolve => setTimeout(resolve, 20));
const waitFor = async (condition: () => boolean) => {
  for (let i = 0; i < 200; i++) {
    if (condition()) return;
    await settle();
  }
  throw new Error('History fixture did not become ready');
};
const id = '123456789';
const makeDevice = (server: string, peerId = id): SavedDevice => {
  const device = { mode: 'id' as const, peerId, idServer: server, serverKey: '', relayServer: '',
    forceRelay: false, hostname: `PC ${server}`, platform: 'Windows', favorite: false, lastConnectedAt: 100 };
  return { ...device, key: deviceKeyFor(device) };
};
const deviceA = makeDevice('a.example');
const deviceB = makeDevice('b.example', '222333444');
const deviceC = makeDevice('c.example', '333444555');
const directDevice: SavedDevice = { key: 'direct:192.0.2.10:21118', mode: 'direct', host: '192.0.2.10', port: '21118',
  hostname: 'Direct PC', platform: 'Windows', favorite: false, lastConnectedAt: 50 };
const requests: ConnectRequest[] = [];
let api: {
  saved: ReturnType<typeof useSavedDevices>;
  configure: (phase: ConnectionPhase, error?: ErrorPayload, ) => void;
  setCurrentServer: (server: string) => void;
};

function Fixture() {
  const saved = useSavedDevices();
  const [phase, setPhase] = useState<ConnectionPhase>('idle');
  const [connectionError, setConnectionError] = useState<ErrorPayload>();
  const [mode, setMode] = useState<'id' | 'direct'>('id');
  const [fields, setFields] = useState({ peerId: id, idServer: 'current.example', relayServer: '', serverKey: '', host: '', port: '21118', password: '' });
  const [forceRelay, setForceRelay] = useState(false);
  const onChangeField = (field: ConnectionField, value: string) => setFields(previous => ({ ...previous, [field]: value }));
  api = { saved, configure: (next, error) => { setPhase(next); setConnectionError(error); },
    setCurrentServer: server => onChangeField('idServer', server) };
  if (!saved.passwordsReady || !saved.gatewayTokenReady) return <div data-testid="restoring-credentials" />;
  return <RustDeskShell locale="en" localePreference="en" isDesktop theme="light" displayPrefs={DEFAULT_DISPLAY_PREFS}
    onChangeLocale={() => {}} onChangeTheme={() => {}} onUpdateDisplayPrefs={() => {}}
    mode={mode} directIpEnabled webRtcOptIn={false} phase={phase} {...fields} forceRelay={forceRelay}
    gatewayToken={saved.gatewayToken} savedGatewayToken={saved.savedGatewayToken}
    gatewayTokenNeedsInput={!saved.gatewayToken.trim() || saved.gatewayTokenRejected}
    gatewayTokenReadFailed={saved.gatewayTokenReadFailed} onSaveGatewayToken={saved.saveGatewayToken}
    detail={connectionError?.detail ?? ''} connectionError={connectionError} decoderError=""
    touchMode={false} diagnosticsOpen={false} devices={saved.devices} savedPasswords={saved.savedPasswords}
    onChangeMode={setMode} onToggleDirectIp={() => {}} onChangeWebRtcOptIn={() => {}}
    onChangeField={onChangeField} onChangeForceRelay={setForceRelay} onClearSavedPassword={saved.handleClearSavedPassword}
    onSelectDevice={device => {
      setMode(device.mode);
      setFields(previous => ({ ...previous, peerId: device.peerId ?? '', idServer: device.idServer ?? '',
        relayServer: device.relayServer ?? '', serverKey: device.serverKey ?? '', host: device.host ?? '', port: device.port ?? '21118' }));
      setForceRelay(device.forceRelay ?? false);
    }}
    onToggleFavorite={saved.handleToggleFavorite} onRemoveDevice={saved.handleRemoveDevice}
    onToggleTouchMode={() => {}} onToggleDiagnostics={() => {}}
    onConnect={request => { requests.push(request!); setPhase('connecting'); setConnectionError(undefined); }}
    onDisconnect={() => setPhase('idle')} onDismissError={() => { setPhase('idle'); setConnectionError(undefined); }} onClose={() => {}} />;
}
const findCard = (device: SavedDevice) => [...document.querySelectorAll<HTMLElement>('.rd-device-card')]
  .find(card => card.textContent?.includes(device.hostname))!;
const click = (element: Element | null | undefined) => {
  if (!(element instanceof HTMLElement)) throw new Error('Missing expected history control');
  flushSync(() => element.click());
};
const connect = (device: SavedDevice) => click(findCard(device)?.querySelector('button'));
const prompt = () => document.querySelector('[data-testid="password-modal"]');
const reset = () => flushSync(() => api.configure('idle'));
const closePrompt = () => click(prompt()?.querySelector('[aria-label="Close"]'));
const setInput = (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  flushSync(() => { setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
};

async function run() {
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem(DEVICES_STORAGE_KEY, JSON.stringify([deviceA, deviceB, deviceC, directDevice]));
  await persistDevicePassword(deviceA.key, 'correct-a', () => true);
  await persistDevicePassword(deviceC.key, 'old-c', () => true);
  await persistDevicePassword(directDevice.key, 'direct-password', () => true);
  await persistGatewayToken('saved-gateway-token');
  const mount = document.createElement('main');
  document.body.append(mount);
  const root = createRoot(mount);
  flushSync(() => root.render(<Fixture />));
  try {
    check(Boolean(document.querySelector('[data-testid="restoring-credentials"]')), 'History waits for credential restoration before accepting a click');
    check(document.querySelectorAll('.rd-device-card').length === 0 && requests.length === 0, 'Pending restoration neither prompts nor connects');
    await waitFor(() => api.saved.passwordsReady && api.saved.gatewayTokenReady);
    check(api.saved.savedPasswords[deviceA.key] === 'correct-a', 'Real browser crypto restores the matching saved password');
    check(api.saved.gatewayToken === 'saved-gateway-token', 'Real browser crypto restores the gateway token');
    connect(deviceA);
    check(!prompt(), 'Idle history click must not open a password dialog');
    check(requests.length === 1 && requests[0].password === 'correct-a', 'Idle history click connects immediately exactly once');
    check(requests[0].idServer === 'a.example', 'History uses its server snapshot, not the previous global server');
    connect(deviceA);
    check(requests.length === 1, 'Repeated click while connecting must not open a second session');

    flushSync(() => api.configure('error', { code: 'UNREACHABLE', stage: 'transport', detail: 'Previous network failure' }));
    connect(deviceA);
    check(!prompt() && requests.length === 2, 'Previous network error must not force a password confirmation');
    check(requests[1].password === 'correct-a', 'Retry still uses the matching stored password');

    reset();
    connect(deviceB);
    check(Boolean(prompt()) && requests.length === 2, 'A history entry without a saved password must prompt');
    check((prompt()?.querySelector('[data-testid="password"]') as HTMLInputElement).value === '', 'Another server password is never prefilled');
    closePrompt();

    reset();
    connect(deviceC);
    check(!prompt() && requests.length === 3, 'A saved password is tried directly without guessing validity');
    flushSync(() => { api.saved.handleClearSavedPassword(deviceC.key); api.configure('error', { code: 'PASSWORD_INVALID', stage: 'login', detail: 'Wrong password' }); });
    await waitFor(() => Boolean(prompt()));
    check(requests.length === 3, 'Password rejection must not automatically retry a bad password');
    check((prompt()?.querySelector('[data-testid="password"]') as HTMLInputElement).value === '', 'Rejected saved password is cleared from the prompt');
    check(prompt()?.textContent?.replace(/\s/g, '').includes(deviceC.peerId!), 'Password rejection reopens only the failed target');
    check(api.saved.savedPasswords[deviceA.key] === 'correct-a', 'An invalid password does not delete unrelated credentials');
    closePrompt();
    connect(deviceA);
    check(!prompt() && requests.length === 4, 'Another valid history target connects immediately after password failure');

    reset();
    flushSync(() => api.saved.setTemporaryGatewayToken(''));
    connect(deviceA);
    check(Boolean(prompt()) && requests.length === 4, 'A genuinely missing gateway token still requires input');
    closePrompt();
    flushSync(() => api.saved.setTemporaryGatewayToken(undefined));
    connect(deviceA);
    check(!prompt() && requests.length === 5, 'Saved gateway token permits direct history connection again');

    reset();
    connect(directDevice);
    check(!prompt() && requests.length === 6 && requests[5].password === 'direct-password', 'Existing direct-IP saved passwords keep working');

    reset();
    connect(deviceC);
    check(Boolean(prompt()) && requests.length === 6, 'A rejected password is no longer reused on the next history click');
    setInput(prompt()!.querySelector('[data-testid="password"]') as HTMLInputElement, 'corrected-c');
    click(prompt()!.querySelector('[data-testid="remember-password"]'));
    click(prompt()!.querySelector('[data-testid="password-confirm-connect"]'));
    check(requests.length === 7 && requests[6].password === 'corrected-c' && requests[6].remember === true,
      'Replacement password is submitted with the requested remember choice');
    flushSync(() => { api.saved.rememberDevicePassword(deviceC.key, 'corrected-c'); api.configure('idle'); });
    connect(deviceC);
    check(!prompt() && requests.length === 8 && requests[7].password === 'corrected-c',
      'A successfully replaced saved password connects directly on the next click');
    result.status = 'passed';
  } finally {
    flushSync(() => root.unmount());
    mount.remove();
  }
}
void run().catch(error => { result.error = String(error); result.status = 'failed'; });
