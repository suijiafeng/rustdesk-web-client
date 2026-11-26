import { useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { useRemoteKeyboard } from '../../src/hooks/useRemoteKeyboard';
import { DEFAULT_DISPLAY_PREFS } from '../../src/lib/displayPrefs';
import type { ClientMessage } from '../../src/lib/protocol';
import type { ConnectionPhase } from '../../src/types';

const result = { status: 'running', violations: [] as string[] };
document.addEventListener('securitypolicyviolation', event => result.violations.push(event.violatedDirective));
const mount = document.createElement('div');
document.body.append(mount);
const root = createRoot(mount);
const messages: ClientMessage[] = [];
const send = (message: ClientMessage) => messages.push(JSON.parse(JSON.stringify(message)));
let state = { menu: false, dialog: false, viewOnly: false, phase: 'live' as ConnectionPhase };
const closeChrome = () => { state = { ...state, menu: false, dialog: false }; render(); };
let keyboard: ReturnType<typeof useRemoteKeyboard>;
let localClicks = 0;

function Fixture() {
  const chromeRef = useRef({ menu: state.menu, dialog: state.dialog });
  const phaseRef = useRef(state.phase);
  const displayPrefsRef = useRef({ ...DEFAULT_DISPLAY_PREFS, viewOnly: state.viewOnly });
  chromeRef.current = { menu: state.menu, dialog: state.dialog };
  phaseRef.current = state.phase;
  displayPrefsRef.current = { ...displayPrefsRef.current, viewOnly: state.viewOnly };
  keyboard = useRemoteKeyboard({ send, closeChrome, chromeRef, phaseRef, displayPrefsRef,
    shortcutModifier: 'Control', showCtrlAltDel: true });
  return <main>
    <input data-testid="remote-capture" autoFocus
      onCompositionStart={() => { keyboard.captureComposingRef.current = true; }}
      onCompositionEnd={event => {
        keyboard.captureComposingRef.current = false;
        keyboard.lastCompositionEndAtRef.current = performance.now();
        keyboard.sendText(event.data);
      }} />
    <button data-testid="local-control" data-session-notice onClick={() => { localClicks++; }}>Local control</button>
  </main>;
}
function render() { flushSync(() => root.render(<Fixture />)); }

Object.assign(window, { keyboardResult: result, keyboardFixture: {
  messages, localClicks: () => localClicks,
  clear() { messages.length = 0; },
  setState(patch: Partial<typeof state>) { state = { ...state, ...patch }; render(); },
  blur() { window.dispatchEvent(new Event('blur')); },
  hidden(value: boolean) {
    if (value) Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    else delete (document as unknown as Record<string, unknown>).visibilityState;
    document.dispatchEvent(new Event('visibilitychange'));
  },
  composing(value: boolean) { keyboard.captureComposingRef.current = value; },
  ime(type: string, data = '') {
    document.querySelector('input')!.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }));
  },
  key(type: string, options: KeyboardEventInit) {
    document.querySelector('input')!.dispatchEvent(new KeyboardEvent(type, { bubbles: true, cancelable: true, ...options }));
  },
  unmount() { flushSync(() => root.render(null)); },
} });
render();
result.status = 'passed';
