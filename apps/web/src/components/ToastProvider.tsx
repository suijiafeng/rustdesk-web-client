// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type ToastTone = 'info' | 'error';
type ShowToast = (message: string, tone?: ToastTone) => void;

interface ToastMessage {
  id: number;
  message: string;
  tone: ToastTone;
}

const ToastContext = createContext<ShowToast | null>(null);
const TOAST_DURATION_MS = { info: 2600, error: 4200 };

export function useToast(): ShowToast {
  const showToast = useContext(ToastContext);
  if (!showToast) throw new Error('useToast requires a ToastProvider');
  return showToast;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [portalTarget, setPortalTarget] = useState<Element>(() => document.fullscreenElement ?? document.body);
  const dismissTimer = useRef<number | undefined>(undefined);
  const nextToastId = useRef(0);

  const showToast = useCallback<ShowToast>((message, tone = 'info') => {
    window.clearTimeout(dismissTimer.current);
    setToast({ id: ++nextToastId.current, message, tone });
    dismissTimer.current = window.setTimeout(() => setToast(null), TOAST_DURATION_MS[tone]);
  }, []);

  useEffect(() => {
    const syncFullscreenTarget = () => setPortalTarget(document.fullscreenElement ?? document.body);
    document.addEventListener('fullscreenchange', syncFullscreenTarget);
    return () => {
      document.removeEventListener('fullscreenchange', syncFullscreenTarget);
      window.clearTimeout(dismissTimer.current);
    };
  }, []);

  return (
    <ToastContext.Provider value={showToast}>
      {children}
      {createPortal(
        <div className="rd-toast-viewport">
          <div role="status" aria-atomic="true">
            {toast?.tone === 'info' ? <div className="rd-toast" key={toast.id}>{toast.message}</div> : null}
          </div>
          <div role="alert" aria-atomic="true">
            {toast?.tone === 'error' ? <div className="rd-toast rd-toast-error" key={toast.id}>{toast.message}</div> : null}
          </div>
        </div>,
        portalTarget,
      )}
    </ToastContext.Provider>
  );
}
