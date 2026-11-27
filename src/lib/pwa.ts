import { useSyncExternalStore } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export interface PwaState {
  isStandalone: boolean;
  canInstall: boolean;
  isIosInstallable: boolean;
  updateAvailable: boolean;
  updateDismissed: boolean;
}

const listeners = new Set<() => void>();
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let waitingWorker: ServiceWorker | null = null;
let initialized = false;
let reloadingForUpdate = false;

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    nav.standalone === true
  );
}

function detectIosSafari(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  const isIos = /iP(hone|ad|od)/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isWebKit = /WebKit/i.test(ua);
  const isOtherIosBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/i.test(ua);
  return isIos && isWebKit && !isOtherIosBrowser;
}

let state: PwaState = {
  isStandalone: detectStandalone(),
  canInstall: false,
  isIosInstallable: !detectStandalone() && detectIosSafari(),
  updateAvailable: false,
  updateDismissed: false,
};

function updateState(patch: Partial<PwaState>): void {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
}

function watchInstallingWorker(worker: ServiceWorker): void {
  worker.addEventListener('statechange', () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      waitingWorker = worker;
      updateState({ updateAvailable: true, updateDismissed: false });
    }
  });
}

export function initPwa(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    updateState({ canInstall: true });
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    updateState({ isStandalone: true, canInstall: false, isIosInstallable: false });
  });

  const displayModeQuery = window.matchMedia?.('(display-mode: standalone)');
  displayModeQuery?.addEventListener?.('change', (ev) => {
    updateState({
      isStandalone: ev.matches,
      isIosInstallable: !ev.matches && detectIosSafari(),
    });
  });

  const canRegisterSw =
    import.meta.env.PROD &&
    'serviceWorker' in navigator &&
    (window.location.protocol === 'https:' || window.location.hostname === 'localhost');

  if (!canRegisterSw) return;

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    void navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (reg.waiting && navigator.serviceWorker.controller) {
          waitingWorker = reg.waiting;
          updateState({ updateAvailable: true, updateDismissed: false });
        }
        if (reg.installing) {
          watchInstallingWorker(reg.installing);
        }
        reg.addEventListener('updatefound', () => {
          if (reg.installing) watchInstallingWorker(reg.installing);
        });
      })
      .catch(() => {});
  });
}

export async function promptPwaInstall(): Promise<boolean> {
  if (!deferredInstallPrompt) return false;
  const promptEvent = deferredInstallPrompt;
  deferredInstallPrompt = null;
  updateState({ canInstall: false });
  try {
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    return choice.outcome === 'accepted';
  } catch {
    return false;
  }
}

export function applyPwaUpdate(): void {
  if (!waitingWorker) {
    window.location.reload();
    return;
  }
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
}

export function dismissPwaUpdate(): void {
  updateState({ updateDismissed: true });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): PwaState {
  return state;
}

export function usePwaState(): PwaState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
