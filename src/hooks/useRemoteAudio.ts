import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConnectionPhase } from '../components/RustDeskShell';
import { t, type Locale } from '../lib/i18n';
import type { ClientMessage } from '../lib/protocol';
import { RemoteAudio, type AudioFailureStage } from '../lib/remoteAudio';
import type { RemoteSocket } from '../lib/remoteSocket';

interface UseRemoteAudioOptions {
  phase: ConnectionPhase;
  locale: Locale;
  wsRef: React.MutableRefObject<WebSocket | RemoteSocket | null>;
  send: (msg: ClientMessage) => void;
  showSessionTip: (text: string, error?: boolean) => void;
}

const FAILURE_MESSAGES = {
  start: 'audioStartFailed',
  module: 'audioModuleFailed',
  decode: 'audioDecodeFailed',
  playback: 'audioFailed',
} as const;

export function useRemoteAudio({
  phase,
  locale,
  wsRef,
  send,
  showSessionTip,
}: UseRemoteAudioOptions) {
  const audioRef = useRef<RemoteAudio | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);

  const stopAudio = useCallback(() => {
    const player = audioRef.current;
    audioRef.current = null;
    player?.close();
    setAudioEnabled(false);
  }, []);

  useEffect(() => {
    if (phase !== 'live') {
      stopAudio();
    }
    return () => {
      audioRef.current?.close();
      audioRef.current = null;
    };
  }, [phase, stopAudio]);

  useEffect(() => {
    if (phase !== 'live' || !audioEnabled) return;
    const recoverAudio = () => {
      if (document.visibilityState === 'hidden') return;
      const player = audioRef.current;
      if (player?.suspended) void player.tryResume();
    };
    document.addEventListener('visibilitychange', recoverAudio);
    window.addEventListener('pointerdown', recoverAudio, true);
    window.addEventListener('keydown', recoverAudio, true);
    return () => {
      document.removeEventListener('visibilitychange', recoverAudio);
      window.removeEventListener('pointerdown', recoverAudio, true);
      window.removeEventListener('keydown', recoverAudio, true);
    };
  }, [phase, audioEnabled]);

  const toggleAudio = async () => {
    if (audioRef.current) {
      stopAudio();
      send({ type: 'audio', enabled: false });
      showSessionTip(t(locale, 'audioStopped'));
      return;
    }
    if (typeof AudioDecoder === 'undefined' || typeof AudioContext === 'undefined') {
      showSessionTip(t(locale, 'audioUnsupported'), true);
      return;
    }
    const socket = wsRef.current;
    let player: RemoteAudio;
    const fail = (stage: AudioFailureStage, error: unknown) => {
      if (socket !== wsRef.current || (player && player !== audioRef.current)) return;
      stopAudio();
      console.error('Remote audio failure', { stage, error });
      showSessionTip(t(locale, FAILURE_MESSAGES[stage]), true);
      send({ type: 'audio', enabled: false });
    };
    try {
      player = new RemoteAudio(fail);
      audioRef.current = player;
      setAudioEnabled(true);
      await player.resume();
      if (player === audioRef.current && socket === wsRef.current) {
        send({ type: 'audio', enabled: true });
        showSessionTip(t(locale, 'audioRequested'));
      }
    } catch (error) {
      fail('start', error);
    }
  };

  return { audioRef, audioEnabled, stopAudio, toggleAudio };
}
