// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useCallback, useEffect, useRef, type CompositionEvent, type FormEvent } from 'react';
import type { ClientMessage } from '@rustdesk-web/shared';
import { shouldIsolateKeyboardEvent } from '../lib/inputIsolation.ts';
import { noteKeyDown, noteKeyUp, releaseTrackedKeys, textMessages, type TrackedKey } from '../lib/keyboard.ts';
import { isImeEvent } from '../lib/keys.ts';
import { adaptKeyMessages, classifyLocalOs, classifyRemoteOs } from '../lib/platform.ts';

const IME_KEY_UP_GRACE_MS = 80;
const CHROME_INPUT_SELECTOR = [
  'input', 'textarea', 'select', 'dialog[open]', '[contenteditable="true"]',
  '[data-adaptive-select]', '[data-testid="session-handle"]', '[data-testid="mobile-dock"]',
  '[data-testid="mobile-capsule"]', '.rd-desktop-toolbar', '.remote-menu-panel', '.rd-clipboard-panel',
].join(', ');

interface RemoteKeyboardOptions {
  enabled?: boolean;
  viewOnly: boolean;
  remotePlatform: string;
  onKeyboard: (messages: ClientMessage[]) => void;
  onArmKeys: (releases: ClientMessage[]) => void;
}

export function useRemoteKeyboard(options: RemoteKeyboardOptions) {
  const captureRef = useRef<HTMLInputElement>(null);
  const trackedKeysRef = useRef<TrackedKey[]>([]);
  const composingRef = useRef(false);
  const compositionEndedAtRef = useRef(0);
  const localOsRef = useRef(classifyLocalOs(navigator.userAgent, navigator.platform));
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const sendKeys = useCallback((messages: ClientMessage[]) => {
    if (messages.length === 0) return;
    const { onKeyboard, remotePlatform } = optionsRef.current;
    const adapted = adaptKeyMessages(messages, localOsRef.current, classifyRemoteOs(remotePlatform));
    if (adapted.length > 0) onKeyboard(adapted);
  }, []);

  const publishKeyState = useCallback(({ tracked, messages }: ReturnType<typeof noteKeyDown>) => {
    trackedKeysRef.current = tracked;
    optionsRef.current.onArmKeys(tracked.map((key) => key.release));
    sendKeys(messages);
  }, [sendKeys]);

  const releaseKeys = useCallback(() => {
    composingRef.current = false;
    publishKeyState(releaseTrackedKeys(trackedKeysRef.current));
  }, [publishKeyState]);

  useEffect(() => {
    if (options.enabled === false) releaseKeys();
  }, [options.enabled, releaseKeys]);

  useEffect(() => {
    function isLocalInput(target: EventTarget | null): boolean {
      if (!(target instanceof Element)) return false;
      if (captureRef.current?.contains(target)) return false;
      return Boolean(target.closest(CHROME_INPUT_SELECTOR));
    }

    function handleKeyEvent(event: KeyboardEvent, trackKey: typeof noteKeyDown) {
      if (optionsRef.current.enabled === false) return;
      const shouldCapture = shouldIsolateKeyboardEvent({
        phase: 'live',
        chromeOpen: false,
        insideChromeInput: isLocalInput(event.target),
      });
      if (!shouldCapture || composingRef.current || isImeEvent(event)) return;
      if (event.type === 'keyup' && performance.now() - compositionEndedAtRef.current < IME_KEY_UP_GRACE_MS) return;

      event.preventDefault();
      event.stopPropagation();
      publishKeyState(trackKey(trackedKeysRef.current, event, optionsRef.current.viewOnly));
    }

    const handleKeyDown = (event: KeyboardEvent) => handleKeyEvent(event, noteKeyDown);
    const handleKeyUp = (event: KeyboardEvent) => handleKeyEvent(event, noteKeyUp);
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', releaseKeys);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', releaseKeys);
      releaseKeys();
    };
  }, [publishKeyState, releaseKeys]);

  function sendText(value: string) {
    if (optionsRef.current.enabled === false) return;
    const { onKeyboard, viewOnly } = optionsRef.current;
    const messages = textMessages(value, viewOnly);
    if (messages.length > 0) onKeyboard(messages);
  }

  function handleCompositionStart() {
    composingRef.current = true;
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLInputElement>) {
    composingRef.current = false;
    compositionEndedAtRef.current = performance.now();
    const committedText = event.data || event.currentTarget.value;
    event.currentTarget.value = '';
    sendText(committedText);
  }

  function handleInput(event: FormEvent<HTMLInputElement>) {
    if (composingRef.current || !event.currentTarget.value) return;
    const text = event.currentTarget.value;
    event.currentTarget.value = '';
    sendText(text);
  }

  return { captureRef, sendKeys, handleCompositionStart, handleCompositionEnd, handleInput };
}
