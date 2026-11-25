// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useEffect, useEffectEvent, useRef } from 'react';
import { useToast } from '../components/ToastProvider.tsx';
import { t, translateAudioIssue, type Locale } from '../lib/i18n.ts';
import type { RestartNotice } from '../session/sessionMachine.ts';

const restartStatusLabels = {
  requested: 'restartWaiting',
  waiting: 'retryWaiting',
  failed: 'restartFailed',
  ended: 'retryEnded',
} as const;

interface SessionToastOptions {
  locale: Locale;
  audioIssue: string;
  privacyFailed: boolean;
  privacyAllowed: boolean | null;
  restartNotice: RestartNotice;
}

export function useSessionToasts({ locale, audioIssue, privacyFailed, privacyAllowed, restartNotice }: SessionToastOptions) {
  const showToast = useToast();
  const previousPrivacyAllowed = useRef<boolean | null>(null);

  const notifyAudioIssue = useEffectEvent((issue: string) => showToast(translateAudioIssue(locale, issue), 'error'));
  const notifyPrivacyFailure = useEffectEvent(() => showToast(t(locale, 'privacyFailed'), 'error'));
  const notifyPrivacyRevoked = useEffectEvent(() => showToast(t(locale, 'privacyUnavailable'), 'error'));
  const notifyRestartStatus = useEffectEvent((status: NonNullable<RestartNotice>) => {
    showToast(t(locale, restartStatusLabels[status]), status === 'failed' || status === 'ended' ? 'error' : 'info');
  });

  useEffect(() => {
    if (audioIssue) notifyAudioIssue(audioIssue);
  }, [audioIssue]);

  useEffect(() => {
    if (privacyFailed) notifyPrivacyFailure();
  }, [privacyFailed]);

  useEffect(() => {
    if (previousPrivacyAllowed.current === true && privacyAllowed === false && !privacyFailed) notifyPrivacyRevoked();
    previousPrivacyAllowed.current = privacyAllowed;
  }, [privacyAllowed, privacyFailed]);

  useEffect(() => {
    if (restartNotice) notifyRestartStatus(restartNotice);
  }, [restartNotice]);
}
