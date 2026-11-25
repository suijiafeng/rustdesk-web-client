// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useCallback, useEffect, useRef, useState } from 'react';
import { codecName, decodeRdv1Frame } from '@rustdesk-web/protocol';
import type { ClientMessage, ServerMessage } from '@rustdesk-web/shared';
import type { ConnectRequest } from '../components/RustDeskShell.tsx';
import { probeCodecs, webCodecsStatus } from '../lib/codecs.ts';
import { RemoteDecoder } from '../lib/decoder.ts';
import { sessionEndLock } from '../lib/displays.ts';
import { RemoteAudio, clampVolume, webAudioStatus } from '../lib/remoteAudio.ts';
import { filterCodecSupport, resolveQualityLevel, resolveTargetFps, type DisplayPrefs } from '../lib/displayPrefs.ts';
import {
  CONNECT_TIMEOUT_MS,
  buildConnectMessage,
  initialSession,
  isCurrentGeneration,
  reduceSession,
  wsUrl,
  type SessionSnapshot,
} from './sessionMachine.ts';

export interface SessionConnectInput {
  mode: 'id' | 'direct';
  peerId: string;
  idServer: string;
  relayServer: string;
  serverKey: string;
  forceRelay: boolean;
  host: string;
  port: string;
  password: string;
  token: string;
  displayPrefs: DisplayPrefs;
}

interface UseSessionOptions {
  readInput: () => SessionConnectInput;
  onPasswordRejected: () => void;
}

export function useSession({ readInput, onPasswordRejected }: UseSessionOptions) {
  const [session, setSession] = useState<SessionSnapshot>(initialSession);
  const [frameSize, setFrameSize] = useState({ width: 0, height: 0 });
  const [decoderError, setDecoderError] = useState('');
  const [audio, setAudio] = useState({ enabled: false, denied: false, volume: 1, issue: '' });
  const audioRef = useRef<RemoteAudio | null>(null);
  const generation = useRef(0);
  const socketRef = useRef<WebSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<RemoteDecoder | null>(null);
  const phaseRef = useRef(session.phase);
  const heldReleaseRef = useRef<ClientMessage | null>(null);
  const armedKeysRef = useRef<ClientMessage[]>([]);
  phaseRef.current = session.phase;

  const apply = useCallback((eventGeneration: number, event: Parameters<typeof reduceSession>[1]) => {
    if (!isCurrentGeneration(generation.current, eventGeneration)) return;
    setSession((current) => {
      const next = reduceSession(current, event);
      if (next.clearPassword) onPasswordRejected();
      phaseRef.current = next.phase;
      return next;
    });
  }, [onPasswordRejected]);

  const releaseDecoder = useCallback(() => {
    decoderRef.current?.close();
    decoderRef.current = null;
    setFrameSize({ width: 0, height: 0 });
  }, []);

  const ensureDecoder = useCallback(() => {
    if (!decoderRef.current) {
      decoderRef.current = new RemoteDecoder({
        onOutput: (width, height) => setFrameSize({ width, height }),
        onError: (message) => setDecoderError(message),
        onNeedRefresh: () => {
          const socket = socketRef.current;
          if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'refresh' }));
          }
        },
      });
    }
    return decoderRef.current;
  }, []);

  const closeSocket = useCallback((socket: WebSocket | null, notify: boolean) => {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (notify && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'disconnect' }));
    }
    socket.close();
  }, []);

  const sendInput = useCallback((messages: ClientMessage[]) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || phaseRef.current !== 'live') return;
    for (const message of messages) {
      if (
        message.type !== 'mouse' && message.type !== 'key' && message.type !== 'text' &&
        message.type !== 'switchDisplay' && message.type !== 'quality' && message.type !== 'followWindow' &&
        message.type !== 'audio'
      ) continue;
      socket.send(JSON.stringify(message));
    }
  }, []);

  const setHeldRelease = useCallback((message: ClientMessage | null) => {
    heldReleaseRef.current = message;
  }, []);

  const setArmedKeys = useCallback((messages: ClientMessage[]) => {
    armedKeysRef.current = messages;
  }, []);

  const releaseHeldInput = useCallback(() => {
    const mouse = heldReleaseRef.current;
    const keys = armedKeysRef.current;
    heldReleaseRef.current = null;
    armedKeysRef.current = [];
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    if (mouse) socket.send(JSON.stringify(mouse));
    for (const message of keys) socket.send(JSON.stringify(message));
  }, []);

  const closeAudio = useCallback(() => {
    audioRef.current?.close();
    audioRef.current = null;
  }, []);

  const startAudio = useCallback(() => {
    const status = webAudioStatus();
    if (!status.ok) {
      setAudio((current) => ({ ...current, enabled: false, issue: status.reason }));
      return;
    }
    if (!audioRef.current) {
      audioRef.current = new RemoteAudio(() => {
        setAudio((current) => ({ ...current, enabled: false, issue: 'Audio playback failed.' }));
      });
      audioRef.current.setVolume(audio.volume);
    }
    void audioRef.current.resume().then(() => {
      sendInput([{ type: 'audio', enabled: true }]);
      setAudio((current) => ({ ...current, enabled: true, denied: false, issue: '' }));
    }).catch(() => {
      setAudio((current) => ({ ...current, enabled: false, issue: 'The browser blocked audio until a user gesture.' }));
    });
  }, [audio.volume, sendInput]);

  const stopAudio = useCallback(() => {
    if (phaseRef.current === 'live') sendInput([{ type: 'audio', enabled: false }]);
    closeAudio();
    setAudio((current) => ({ ...current, enabled: false }));
  }, [closeAudio, sendInput]);

  const setAudioVolume = useCallback((value: number) => {
    const volume = audioRef.current?.setVolume(value) ?? clampVolume(value);
    setAudio((current) => ({ ...current, volume }));
  }, []);

  const disconnect = useCallback(() => {
    const eventGeneration = ++generation.current;
    const lock = sessionEndLock(
      readInput().displayPrefs.lockAfterSessionEnd,
      phaseRef.current === 'live',
    );
    if (lock.length > 0) sendInput(lock);
    releaseHeldInput();
    closeAudio();
    setAudio({ enabled: false, denied: false, volume: 1, issue: '' });
    closeSocket(socketRef.current, true);
    socketRef.current = null;
    releaseDecoder();
    setDecoderError('');
    apply(eventGeneration, { type: 'disconnect' });
  }, [apply, closeAudio, closeSocket, readInput, releaseDecoder, releaseHeldInput, sendInput]);

  const connect = useCallback(async (request?: ConnectRequest) => {
    const input = readInput();
    const mode = request?.mode ?? input.mode;
    const peerId = (request?.peerId ?? input.peerId).replace(/\s+/g, '');
    const idServer = (request?.idServer ?? input.idServer).trim();
    const host = (request?.host ?? input.host).trim();
    const portText = String(request?.port ?? input.port).trim() || '21118';
    const codecsStatus = webCodecsStatus();
    if (!codecsStatus.ok) {
      setSession((current) => ({
        ...initialSession,
        phase: 'error',
        errorMessage: codecsStatus.reason,
        authRequired: current.authRequired,
      }));
      return;
    }
    if (mode === 'direct' && !host) {
      setSession((current) => ({ ...current, phase: 'error', errorMessage: 'Enter the remote address.' }));
      return;
    }
    if (mode === 'id' && (!peerId || !idServer)) {
      setSession((current) => ({ ...current, phase: 'error', errorMessage: 'Enter the remote ID and ID server.' }));
      return;
    }

    const eventGeneration = ++generation.current;
    releaseDecoder();
    closeAudio();
    setAudio({ enabled: false, denied: false, volume: 1, issue: '' });
    setDecoderError('');
    apply(eventGeneration, { type: 'connect-started' });
    const rawSupport = await probeCodecs();
    if (!isCurrentGeneration(generation.current, eventGeneration)) return;
    if (!rawSupport.vp8 && !rawSupport.vp9 && !rawSupport.h264 && !rawSupport.h265 && !rawSupport.av1) {
      setSession((current) => ({
        ...current,
        phase: 'error',
        errorMessage: 'This browser cannot decode VP8, VP9, H.264, HEVC, or AV1.',
      }));
      return;
    }

    closeSocket(socketRef.current, false);
    const support = filterCodecSupport(rawSupport, input.displayPrefs.codec);
    const message = buildConnectMessage({
      mode,
      peerId,
      idServer,
      relayServer: (request?.relayServer ?? input.relayServer).trim(),
      serverKey: (request?.serverKey ?? input.serverKey).trim(),
      forceRelay: request?.forceRelay ?? input.forceRelay,
      host,
      port: Number(portText) || 21118,
      password: request?.password ?? input.password,
      token: input.token,
      codecs: support,
      quality: resolveQualityLevel(input.displayPrefs.qualityPreset, input.displayPrefs.customBitrate),
      fps: resolveTargetFps(input.displayPrefs.qualityPreset, input.displayPrefs.customFps),
      codec: input.displayPrefs.codec,
    });

    const socket = new WebSocket(wsUrl(window.location));
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;
    const timer = window.setTimeout(() => {
      if (!isCurrentGeneration(generation.current, eventGeneration)) return;
      if (phaseRef.current !== 'connecting') return;
      apply(eventGeneration, { type: 'timeout' });
      releaseDecoder();
      closeSocket(socket, false);
    }, CONNECT_TIMEOUT_MS);

    const finishTimer = () => window.clearTimeout(timer);
    socket.onopen = () => {
      if (!isCurrentGeneration(generation.current, eventGeneration) || socketRef.current !== socket) return;
      socket.send(JSON.stringify(message));
    };
    socket.onmessage = (ev) => {
      if (!isCurrentGeneration(generation.current, eventGeneration) || socketRef.current !== socket) return;
      if (ev.data instanceof ArrayBuffer) {
        const frame = decodeRdv1Frame(new Uint8Array(ev.data));
        if (!frame) return;
        ensureDecoder().push(
          {
            codec: frame.codec,
            codecName: codecName(frame.codec),
            key: frame.key,
            display: frame.display,
            width: frame.width,
            height: frame.height,
            pts: Number(frame.pts),
            gatewayUnixMs: Number(frame.gatewayUnixMs),
            data: frame.data,
          },
          canvasRef.current,
        );
        return;
      }
      if (typeof ev.data !== 'string') return;
      let parsed: ServerMessage;
      try {
        parsed = JSON.parse(ev.data) as ServerMessage;
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') return;
      if (parsed.type === 'audioFormat') {
        audioRef.current?.configure(parsed.sampleRate, parsed.channels);
        return;
      }
      if (parsed.type === 'audioFrame') {
        audioRef.current?.push(parsed.packet);
        return;
      }
      if (parsed.type === 'audioDenied') {
        closeAudio();
        setAudio((current) => ({ ...current, enabled: false, denied: true, issue: 'The host refused audio.' }));
        return;
      }
      apply(eventGeneration, { type: 'server', message: parsed });
    };
    socket.onerror = () => {
      if (!isCurrentGeneration(generation.current, eventGeneration) || socketRef.current !== socket) return;
      finishTimer();
      apply(eventGeneration, { type: 'socket-error' });
    };
    socket.onclose = () => {
      if (!isCurrentGeneration(generation.current, eventGeneration) || socketRef.current !== socket) return;
      finishTimer();
      socketRef.current = null;
      releaseDecoder();
      apply(eventGeneration, { type: 'socket-close' });
    };
  }, [apply, closeAudio, closeSocket, ensureDecoder, readInput, releaseDecoder]);

  useEffect(() => () => {
    generation.current += 1;
    const mouse = heldReleaseRef.current;
    const keys = armedKeysRef.current;
    heldReleaseRef.current = null;
    armedKeysRef.current = [];
    const socket = socketRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      if (mouse) socket.send(JSON.stringify(mouse));
      for (const message of keys) socket.send(JSON.stringify(message));
    }
    closeSocket(socketRef.current, true);
    socketRef.current = null;
    decoderRef.current?.close();
    decoderRef.current = null;
    audioRef.current?.close();
    audioRef.current = null;
  }, [closeSocket]);

  return {
    session,
    connect,
    disconnect,
    sendInput,
    setHeldRelease,
    setArmedKeys,
    canvasRef,
    frameSize,
    decoderError,
    audio,
    startAudio,
    stopAudio,
    setAudioVolume,
  };
}
