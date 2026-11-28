import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { DisplayPrefs } from '../lib/displayPrefs';
import { shouldIsolateKeyboardEvent } from '../lib/inputIsolation';
import {
  isImeEvent,
  isModifier,
  isPrintableAscii,
  activeModifiers,
  controlFromKeyOrCode,
  mapPhysicalKeyDown,
} from '../lib/keys';
import type { ClientMessage } from '../lib/protocol';
import type { ConnectionPhase } from '../types';

interface Options {
  send: (message: ClientMessage) => void;
  closeChrome: () => void;
  chromeRef: RefObject<{ menu: boolean; dialog: boolean }>;
  phaseRef: RefObject<ConnectionPhase>;
  displayPrefsRef: RefObject<DisplayPrefs>;
  shortcutModifier: 'Meta' | 'Control';
  showCtrlAltDel: boolean;
}

type PressedKey = Extract<ReturnType<typeof mapPhysicalKeyDown>, { type: 'key' }>;
const remoteKeyId = (key: PressedKey) => key.control ? `control:${key.control}` : `chr:${key.chr}`;
const physicalKeyId = (event: KeyboardEvent) => event.code && event.code !== 'Unidentified'
  ? event.code : `key:${controlFromKeyOrCode('', event.key) ?? event.key.toLowerCase()}`;

export function useRemoteKeyboard({
  send,
  closeChrome,
  chromeRef,
  phaseRef,
  displayPrefsRef,
  shortcutModifier,
  showCtrlAltDel,
}: Options) {
  const captureComposingRef = useRef(false);
  const lastCompositionEndAtRef = useRef(0);
  const pressedKeysRef = useRef(new Map<string, PressedKey>());

  const releaseKey = useCallback((physicalId: string, modifiers?: string[]) => {
    const pressed = pressedKeysRef.current;
    const key = pressed.get(physicalId);
    if (!key) return;
    pressed.delete(physicalId);
    // Left/right modifiers currently share one protocol control key. Releasing
    // either physical key must not release the other while it is still held.
    if (Array.from(pressed.values()).some(other => remoteKeyId(other) === remoteKeyId(key))) return;
    const remainingModifiers = modifiers ?? Array.from(new Set(
      Array.from(pressed.values()).flatMap(other => other.control && isModifier(other.control) ? [other.control] : []),
    ));
    send({ type: 'key', action: 'up', control: key.control, chr: key.chr,
      modifiers: remainingModifiers.length ? remainingModifiers : undefined });
  }, [send]);

  const releasePressedKeys = useCallback(() => {
    // Release characters before their modifiers, and clear each tracked entry
    // before sending so a delayed browser keyup cannot emit a second release.
    const pressed = Array.from(pressedKeysRef.current.entries()).reverse();
    pressed.sort(([, left], [, right]) => Number(isModifier(left.control ?? '')) - Number(isModifier(right.control ?? '')));
    for (const [physicalId] of pressed) {
      try { releaseKey(physicalId); } catch { /* The connection may already be closed. */ }
    }
    captureComposingRef.current = false;
  }, [releaseKey]);

  const inputAllowed = phaseRef.current === 'live' && !displayPrefsRef.current.viewOnly &&
    !chromeRef.current.menu && !chromeRef.current.dialog;
  useEffect(() => {
    if (!inputAllowed) releasePressedKeys();
  }, [inputAllowed, releasePressedKeys]);

  // Forward text efficiently: single ASCII chars as native keystrokes, CJK/multi-char as batched seq
  const sendText = useCallback(
    (text: string) => {
      if (!text || displayPrefsRef.current.viewOnly) return;
      if (text === ' ') {
        send({ type: 'key', action: 'down', control: 'Space' });
        send({ type: 'key', action: 'up', control: 'Space' });
        return;
      }
      if (isPrintableAscii(text)) {
        send({ type: 'key', action: 'down', chr: text });
        send({ type: 'key', action: 'up', chr: text });
        return;
      }
      const chars = Array.from(text);
      const CHUNK = 64;
      for (let i = 0; i < chars.length; i += CHUNK) {
        send({ type: 'text', text: chars.slice(i, i + CHUNK).join('') });
      }
    },
    [send, displayPrefsRef],
  );

  const tapControl = useCallback(
    (control: string) => {
      if (chromeRef.current.menu || chromeRef.current.dialog || displayPrefsRef.current.viewOnly) return;
      send({ type: 'key', action: 'down', control });
      send({ type: 'key', action: 'up', control });
    },
    [send, chromeRef, displayPrefsRef],
  );

  const sendChord = useCallback(
    (parts: Array<{ control?: string; chr?: string }>) => {
      if (chromeRef.current.menu || chromeRef.current.dialog || displayPrefsRef.current.viewOnly) return;
      const modifiers = parts
        .map((p) => p.control)
        .filter((c): c is string => Boolean(c && isModifier(c)));

      for (const part of parts) {
        if (part.control) {
          send({ type: 'key', action: 'down', control: part.control, modifiers });
        } else if (part.chr) {
          send({ type: 'key', action: 'down', chr: part.chr, modifiers });
        }
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const part = parts[i];
        if (part.chr) {
          send({ type: 'key', action: 'up', chr: part.chr, modifiers });
        } else if (part.control) {
          send({ type: 'key', action: 'up', control: part.control, modifiers });
        }
      }
    },
    [send, chromeRef, displayPrefsRef],
  );

  const handleQuickKey = useCallback(
    (name: 'Esc' | 'Tab' | 'Ctrl+C' | 'Ctrl+V' | 'Ctrl+Alt+Del' | 'Lock') => {
      if (name === 'Ctrl+Alt+Del' && !showCtrlAltDel) return;
      closeChrome();
      if (name === 'Esc') tapControl('Escape');
      else if (name === 'Tab') tapControl('Tab');
      else if (name === 'Ctrl+C') sendChord([{ control: shortcutModifier }, { chr: 'c' }]);
      else if (name === 'Ctrl+V') sendChord([{ control: shortcutModifier }, { chr: 'v' }]);
      else if (name === 'Ctrl+Alt+Del') tapControl('CtrlAltDel');
      else if (name === 'Lock') tapControl('LockScreen');
    },
    [closeChrome, sendChord, shortcutModifier, showCtrlAltDel, tapControl],
  );

  // Global physical keyboard listener (capture phase + full host-browser shortcut isolation)
  useEffect(() => {
    const isInsideChromeInput = (target: EventTarget | null): boolean => {
      if (!(target instanceof Element)) return false;
      return Boolean(
        target.closest('[data-testid="connection-panel"]') ||
          target.closest('[data-adaptive-select], [data-session-confirm], [data-session-notice]') ||
          target.closest('[data-testid="session-menu"]') ||
          target.closest('[data-testid="softbar"]'),
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isInsideChromeInput(e.target) || chromeRef.current.menu || chromeRef.current.dialog || displayPrefsRef.current.viewOnly) {
        releasePressedKeys();
      }
      if (e.target instanceof Element && e.target.closest('[data-adaptive-select], [data-session-confirm], [data-session-notice]')) return;
      if (chromeRef.current.menu || chromeRef.current.dialog) {
        if (e.key === 'Escape' && phaseRef.current === 'live') {
          e.preventDefault();
          closeChrome();
          return;
        }
        if (isInsideChromeInput(e.target)) {
          return;
        }
        e.preventDefault();
        return;
      }

      if (
        !shouldIsolateKeyboardEvent({
          phase: phaseRef.current,
          chromeOpen: chromeRef.current.menu || chromeRef.current.dialog,
          insideChromeInput: isInsideChromeInput(e.target),
        })
      ) {
        return;
      }

      // Let native OS IME (Chinese/Japanese/Korean) compose smoothly inside the hidden capture input
      if (captureComposingRef.current || isImeEvent(e)) {
        return;
      }

      // Prevent host browser shortcuts (Ctrl+R/F/P/S/+/-, Tab, Space, Backspace, Alt, F1-F12, repeats)
      e.preventDefault();
      e.stopPropagation();

      if (displayPrefsRef.current.viewOnly) {
        return;
      }

      const mapped = mapPhysicalKeyDown(e);
      if (mapped) {
        if (mapped.type === 'key') {
          const id = physicalKeyId(e);
          const previous = pressedKeysRef.current.get(id);
          // Auto-repeat can change 'A' into 'a' when Shift is released first.
          if (previous && remoteKeyId(previous) !== remoteKeyId(mapped)) releaseKey(id, activeModifiers(e));
          send(mapped);
          pressedKeysRef.current.set(id, mapped);
        } else {
          send(mapped);
        }
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      // A previously sent key must be released even if focus moved into local
      // chrome, view-only was enabled, or an IME composition has since started.
      releaseKey(physicalKeyId(e), activeModifiers(e));
      if (
        !shouldIsolateKeyboardEvent({
          phase: phaseRef.current,
          chromeOpen: chromeRef.current.menu || chromeRef.current.dialog,
          insideChromeInput: isInsideChromeInput(e.target),
        })
      ) {
        return;
      }

      if (
        captureComposingRef.current ||
        isImeEvent(e) ||
        performance.now() - lastCompositionEndAtRef.current < 80
      ) {
        return;
      }

      // Prevent Alt/Meta keyup from focusing browser chrome menus
      e.preventDefault();
      e.stopPropagation();
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') releasePressedKeys();
    };
    const onFocusIn = (event: FocusEvent) => {
      if (isInsideChromeInput(event.target)) releasePressedKeys();
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', releasePressedKeys);
    document.addEventListener('visibilitychange', onVisibilityChange);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', releasePressedKeys);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.removeEventListener('focusin', onFocusIn);
      releasePressedKeys();
    };
  }, [closeChrome, send, releaseKey, releasePressedKeys]);

  return {
    captureComposingRef,
    lastCompositionEndAtRef,
    sendText,
    sendChord,
    handleQuickKey,
  };
}
