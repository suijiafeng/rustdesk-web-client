// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import { useCallback, useEffect, useRef, useState } from 'react';
import { codecName, decodeRdv1Frame } from '@rustdesk-web/protocol';
import type { ClientMessage, CodecSupport, ServerMessage } from '@rustdesk-web/shared';
import type { ConnectRequest } from '../components/RustDeskShell.tsx';
import { probeCodecs, webCodecsStatus } from '../lib/codecs.ts';
import { RemoteDecoder } from '../lib/decoder.ts';
import { acceptRtt } from '../lib/diagnostics.ts';
import { computeFrameRates, createFrameStats, recordRenderedFrame, recordRxFrame } from '../lib/frameStats.ts';
import {
  computeDiagnosticsSummary,
  createDiagnosticsState,
  recordPingSent,
  recordPongReceived,
  sweepTimeouts,
} from '../lib/linkHealth.ts';
import { sessionEndLock } from '../lib/displays.ts';
import { textMessages } from '../lib/keyboard.ts';
import { useClipboardSync } from '../hooks/useClipboardSync.ts';
import { createSessionSocket, gatewayEnablesWebRtc, type SessionSocket } from './sessionTransport.ts';
import { reconnectDelayMs, TWO_FACTOR_TIMEOUT_MS, twoFactorStatus, validateChatText, validateClipboardText, validateTwoFactorCode, type ClipboardActionResult } from '../lib/platform.ts';
import { RemoteAudio, clampVolume, webAudioStatus } from '../lib/remoteAudio.ts';
import { resolveQualityLevel, resolveTargetFps, type DisplayPrefs } from '../lib/displayPrefs.ts';
import {
  CONNECT_TIMEOUT_MS,
  buildConnectMessage,
  canSendSessionMessage,
  initialSession,
  RESTART_GAP_MS,
  RESTART_OFFLINE_MS,
  RESTART_RETRY_MS,
  isCurrentGeneration,
  nextPrivacyState,
  reduceSession,
  restartReconnectDue,
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
  const [stats, setStats] = useState({ startedAt: 0, frames: 0, bytes: 0, rttMs: null as number | null });
  const [quality, setQuality] = useState({
    fps: 0,
    bitrate: 0,
    streamState: 'waiting' as 'waiting' | 'active' | 'idle',
    browserRttMs: null as number | null,
    lossPct: 0,
    linkHealth: 'waiting' as 'waiting' | 'good' | 'fair' | 'poor',
  });
  const frameStatsRef = useRef(createFrameStats());
  const linkRef = useRef(createDiagnosticsState());
  const pingSeqRef = useRef(0);
  const audioRef = useRef<RemoteAudio | null>(null);
  const generation = useRef(0);
  const socketRef = useRef<SessionSocket | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const decoderRef = useRef<RemoteDecoder | null>(null);
  const phaseRef = useRef(session.phase);
  const sessionRef = useRef(session);
  const [codecSupport, setCodecSupport] = useState<CodecSupport | null>(null);
  const [clipboardSync, setClipboardSync] = useState(false);
  const [clipboardFallback, setClipboardFallback] = useState<string | null>(null);
  const [privacy, setPrivacy] = useState({ enabled: false, pending: false, failed: false });
  const [restartNotice, setRestartNotice] = useState<null | 'requested' | 'waiting' | 'failed' | 'ended'>(null);
  const lastConnectRef = useRef<ConnectRequest | null>(null);
  const restartDeadlineRef = useRef(0);
  const restartModeRef = useRef<null | 'requested' | 'waiting'>(null);
  const userClosedRef = useRef(false);
  const reconnectAttemptRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);
  const [chatLines, setChatLines] = useState<{ direction: 'in' | 'out'; text: string }[]>([]);
  const [twoFactor, setTwoFactor] = useState<null | 'required' | 'submitted' | 'failed' | 'expired'>(null);
  const twoFactorMeta = useRef({ started: 0, attempts: 0 });
  const heldReleaseRef = useRef<ClientMessage | null>(null);
  const armedKeysRef = useRef<ClientMessage[]>([]);
  phaseRef.current = session.phase;
  sessionRef.current = session;

  const webRtcEnabled = useRef(false);
  useEffect(() => {
    const abort = new AbortController();
    void gatewayEnablesWebRtc(abort.signal).then((enabled) => {
      if (!abort.signal.aborted) webRtcEnabled.current = enabled;
    });
    return () => abort.abort();
  }, []);

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
        onOutput: (width, height, _renderedCount, nowMs) => {
          recordRenderedFrame(frameStatsRef.current, nowMs);
          setFrameSize({ width, height });
        },
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

  const closeSocket = useCallback((socket: SessionSocket | null, notify: boolean) => {
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
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    let sent = false;
    try {
      for (const message of messages) {
        if (!canSendSessionMessage(phaseRef.current, message.type)) continue;
        socket.send(JSON.stringify(message));
        sent = true;
      }
    } catch {
      return false;
    }
    return sent;
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
    userClosedRef.current = true;
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
    const eventGeneration = ++generation.current;
    const lock = sessionEndLock(
      readInput().displayPrefs.lockAfterSessionEnd,
      phaseRef.current === 'live',
    );
    if (lock.length > 0) sendInput(lock);
    releaseHeldInput();
    closeAudio();
    setAudio({ enabled: false, denied: false, volume: 1, issue: '' });
    setStats({ startedAt: 0, frames: 0, bytes: 0, rttMs: null });
    frameStatsRef.current = createFrameStats();
    linkRef.current = createDiagnosticsState();
    pingSeqRef.current = 0;
    setQuality({ fps: 0, bitrate: 0, streamState: 'waiting', browserRttMs: null, lossPct: 0, linkHealth: 'waiting' });
    closeSocket(socketRef.current, true);
    socketRef.current = null;
    releaseDecoder();
    setDecoderError('');
    setClipboardFallback(null);
    setPrivacy({ enabled: false, pending: false, failed: false });
    lastConnectRef.current = null;
    restartModeRef.current = null;
    setRestartNotice(null);
    apply(eventGeneration, { type: 'disconnect' });
  }, [apply, closeAudio, closeSocket, readInput, releaseDecoder, releaseHeldInput, sendInput]);

  const sendClipboard = useCallback((text: string, asInput = false): ClipboardActionResult => {
    const socket = socketRef.current;
    const { disableClipboard, viewOnly } = readInput().displayPrefs;
    const allowed = sessionRef.current.peer?.clipboardAllowed === true;
    const decision = validateClipboardText(text, disableClipboard, allowed);
    if (decision !== 'ok') return decision;
    if (asInput && viewOnly) return 'view-only';
    if (!socket || socket.readyState !== WebSocket.OPEN || phaseRef.current !== 'live') return 'disconnected';
    const messages: ClientMessage[] = asInput ? textMessages(text, false) : [{ type: 'clipboard', text }];
    try {
      for (const message of messages) socket.send(JSON.stringify(message));
      return 'ok';
    } catch {
      return 'disconnected';
    }
  }, [readInput]);

  const clipboardAllowed = session.phase === 'live' && session.peer?.clipboardAllowed === true
    && !readInput().displayPrefs.disableClipboard;
  const syncEnabled = clipboardSync && clipboardAllowed;
  const { receive: receiveClipboard, readLocal: syncClipboardNow, sendLocal: syncPastedClipboard,
    noteCopied: noteClipboardCopied, needsRead: clipboardSyncNeedsRead } =
    useClipboardSync(syncEnabled, sendClipboard, setClipboardFallback);

  useEffect(() => {
    if (!clipboardAllowed) {
      setClipboardSync(false);
      setClipboardFallback(null);
    }
  }, [clipboardAllowed]);

  const toggleClipboardSync = useCallback(() => {
    if (clipboardAllowed) setClipboardSync((current) => !current);
  }, [clipboardAllowed]);

  const connectRef = useRef<(request?: ConnectRequest) => Promise<void>>(async () => {});
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

    userClosedRef.current = false;
    lastConnectRef.current = {
      mode,
      peerId,
      idServer,
      relayServer: (request?.relayServer ?? input.relayServer).trim(),
      serverKey: (request?.serverKey ?? input.serverKey).trim(),
      forceRelay: request?.forceRelay ?? input.forceRelay,
      host,
      port: portText,
      password: request?.password ?? input.password,
    };
    const eventGeneration = ++generation.current;
    releaseDecoder();
    closeAudio();
    setAudio({ enabled: false, denied: false, volume: 1, issue: '' });
    setDecoderError('');
    twoFactorMeta.current = { started: 0, attempts: 0 };
    setTwoFactor(null);
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
    setCodecSupport(rawSupport);
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
      codecs: rawSupport,
      quality: resolveQualityLevel(input.displayPrefs.qualityPreset, input.displayPrefs.customBitrate),
      fps: resolveTargetFps(input.displayPrefs.qualityPreset, input.displayPrefs.customFps),
      codec: input.displayPrefs.codec,
    });

    const socket = createSessionSocket(wsUrl(window.location), message, webRtcEnabled.current);
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;
    const onConnectTimeout = () => {
      if (!isCurrentGeneration(generation.current, eventGeneration) || socketRef.current !== socket) return;
      if (phaseRef.current !== 'connecting') return;
      apply(eventGeneration, { type: 'timeout' });
      releaseDecoder();
      closeSocket(socket, false);
      if (twoFactorMeta.current.started) setTwoFactor('expired');
    };
    let timer = window.setTimeout(onConnectTimeout, CONNECT_TIMEOUT_MS);
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
        recordRxFrame(frameStatsRef.current, Date.now(), ev.data.byteLength);
        setStats((current) => ({
          startedAt: current.startedAt || Date.now(),
          frames: current.frames + 1,
          bytes: current.bytes + ev.data.byteLength,
          rttMs: current.rttMs,
        }));
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
      if (parsed.type === 'pong') {
        linkRef.current = recordPongReceived(linkRef.current, parsed.seq, Date.now());
        const summary = computeDiagnosticsSummary(linkRef.current, Date.now());
        setQuality((current) => ({
          ...current,
          browserRttMs: summary.currentRttMs,
          lossPct: summary.packetLossPct,
          linkHealth: summary.health,
        }));
        return;
      }
      if (parsed.type === 'rtt') {
        const rttMs = acceptRtt(parsed.ms);
        if (rttMs !== null) setStats((current) => ({ ...current, rttMs }));
        return;
      }
      if (parsed.type === 'status' && parsed.state === 'live' ) {
        setStats((current) => ({ ...current, startedAt: current.startedAt || Date.now() }));
      }
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
      if (parsed.type === 'clipboard') {
        const text = parsed.text ?? '';
        const allowed = sessionRef.current.peer?.clipboardAllowed === true;
        const decision = validateClipboardText(text, readInput().displayPrefs.disableClipboard, allowed);
        if (decision !== 'ok') return;
        apply(eventGeneration, { type: 'server', message: parsed });
        void receiveClipboard(text);
        return;
      }
      if (parsed.type === 'twoFactorRequired') {
        if (!twoFactorMeta.current.started) {
          twoFactorMeta.current.started = Date.now();
          finishTimer();
          timer = window.setTimeout(onConnectTimeout, TWO_FACTOR_TIMEOUT_MS);
        }
        const status = twoFactorStatus(twoFactorMeta.current.attempts, Date.now() - twoFactorMeta.current.started);
        setTwoFactor(status === 'ok' ? 'required' : status === 'expired' ? 'expired' : 'failed');
        return;
      }
      if (parsed.type === 'status' && parsed.state === 'live') {
        finishTimer();
        twoFactorMeta.current = { started: 0, attempts: 0 };
        setTwoFactor(null);
      }
      if (parsed.type === 'chat') {
        const text = typeof parsed.text === 'string' ? parsed.text : '';
        if (validateChatText(text) === 'ok') {
          setChatLines((lines) => [...lines, { direction: 'in' as const, text: text.trim() }].slice(-50));
        }
        return;
      }
      if (parsed.type === 'privacyResult') {
        setPrivacy((current) => nextPrivacyState(current, parsed));
      }
      if (parsed.type === 'restartResult' && !parsed.sent) {
        restartModeRef.current = null;
        setRestartNotice('failed');
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
      if (restartModeRef.current === 'requested') {
        restartModeRef.current = 'waiting';
        setRestartNotice('waiting');
      } else if (!userClosedRef.current && phaseRef.current === 'live' && lastConnectRef.current && reconnectTimerRef.current === null) {
        const delay = reconnectDelayMs(reconnectAttemptRef.current + 1);
        if (delay !== null) {
          const attempt = reconnectAttemptRef.current + 1;
          reconnectAttemptRef.current = attempt;
          setReconnectAttempt(attempt);
          reconnectTimerRef.current = window.setTimeout(() => {
            reconnectTimerRef.current = null;
            const saved = lastConnectRef.current;
            if (!userClosedRef.current && saved) void connectRef.current(saved);
          }, delay);
        }
      }
      apply(eventGeneration, { type: 'socket-close' });
    };
  }, [apply, closeAudio, closeSocket, ensureDecoder, readInput, receiveClipboard, releaseDecoder]);
  connectRef.current = connect;

  useEffect(() => {
    if (session.phase !== 'live') return;
    const timer = window.setInterval(() => {
      const now = Date.now();
      linkRef.current = sweepTimeouts(linkRef.current, now);
      const seq = pingSeqRef.current + 1;
      pingSeqRef.current = seq;
      linkRef.current = recordPingSent(linkRef.current, seq, now);
      sendInput([{ type: 'ping', seq, clientTs: now }]);
      const rates = computeFrameRates(frameStatsRef.current, now);
      const summary = computeDiagnosticsSummary(linkRef.current, now);
      setQuality({
        fps: rates.fps,
        bitrate: rates.bitrate,
        streamState: rates.streamState,
        browserRttMs: summary.currentRttMs,
        lossPct: summary.packetLossPct,
        linkHealth: summary.health,
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [sendInput, session.phase]);

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

  const pasteLocalClipboard = useCallback(async (): Promise<ClipboardActionResult> => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || phaseRef.current !== 'live') return 'disconnected';
    const { viewOnly, disableClipboard } = readInput().displayPrefs;
    if (viewOnly) return 'view-only';
    if (disableClipboard) return 'disabled';
    if (sessionRef.current.peer?.clipboardAllowed !== true) return 'denied';
    let text: string;
    try {
      if (!navigator.clipboard?.readText) return 'read-failed';
      text = await navigator.clipboard.readText();
    } catch {
      return 'read-failed';
    }
    if (socket !== socketRef.current) return 'disconnected';
    return sendClipboard(text, true);
  }, [readInput, sendClipboard]);

  const dismissClipboard = useCallback(() => setClipboardFallback(null), []);

  const submitTwoFactor = useCallback((code: string) => {
    const elapsed = Date.now() - twoFactorMeta.current.started;
    const status = twoFactorStatus(twoFactorMeta.current.attempts, elapsed);
    if (status !== 'ok') {
      setTwoFactor(status === 'expired' ? 'expired' : 'failed');
      return;
    }
    const trimmed = code.trim();
    if (!validateTwoFactorCode(trimmed)) return;
    if (twoFactor !== 'required') return;
    if (sendInput([{ type: 'auth2fa', code: trimmed }])) {
      twoFactorMeta.current.attempts += 1;
      setTwoFactor('submitted');
    } else {
      setTwoFactor('failed');
    }
  }, [sendInput, twoFactor]);

  const sendChat = useCallback((text: string) => {
    if (validateChatText(text) !== 'ok' || phaseRef.current !== 'live') return;
    const trimmed = text.trim();
    if (!sendInput([{ type: 'chat', text: trimmed }])) return;
    setChatLines((lines) => [...lines, { direction: 'out' as const, text: trimmed }].slice(-50));
  }, [sendInput]);

  const cancelReconnect = useCallback(() => {
    userClosedRef.current = true;
    reconnectAttemptRef.current = 0;
    setReconnectAttempt(0);
    if (reconnectTimerRef.current !== null) window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);

  const requestRestart = useCallback(() => {
    if (phaseRef.current !== 'live' || sessionRef.current.peer?.restartAllowed !== true || restartModeRef.current) return;
    if (!sendInput([{ type: 'restart' }])) {
      setRestartNotice('failed');
      return;
    }
    restartDeadlineRef.current = Date.now() + RESTART_RETRY_MS;
    restartModeRef.current = 'requested';
    setRestartNotice('requested');
  }, [sendInput]);

  useEffect(() => {
    if (restartNotice !== 'waiting') return;
    if (!restartReconnectDue(Date.now(), restartDeadlineRef.current, session.phase)) {
      if (session.phase === 'idle' || session.phase === 'error') setRestartNotice('ended');
      return;
    }
    const timer = window.setTimeout(() => {
      const saved = lastConnectRef.current;
      if (saved && restartReconnectDue(Date.now(), restartDeadlineRef.current, phaseRef.current)) void connect(saved);
    }, RESTART_GAP_MS);
    return () => window.clearTimeout(timer);
  }, [connect, restartNotice, session.phase]);

  useEffect(() => {
    if (restartNotice !== 'requested' && restartNotice !== 'waiting') return;
    const limit = restartNotice === 'requested'
      ? RESTART_OFFLINE_MS
      : Math.max(0, restartDeadlineRef.current - Date.now());
    const timer = window.setTimeout(() => {
      restartModeRef.current = null;
      setRestartNotice(restartNotice === 'requested' ? 'failed' : 'ended');
    }, limit);
    return () => window.clearTimeout(timer);
  }, [restartNotice]);

  const togglePrivacy = useCallback(() => {
    if (phaseRef.current !== 'live' || sessionRef.current.peer?.privacyAllowed !== true || privacy.pending) return;
    const enabled = !privacy.enabled;
    const sent = sendInput([{ type: 'privacy', enabled }]);
    setPrivacy({ enabled: privacy.enabled, pending: sent, failed: !sent });
  }, [privacy.enabled, privacy.pending, sendInput]);

  useEffect(() => {
    if (!privacy.pending) return;
    const timer = window.setTimeout(() => setPrivacy((current) => (
      current.pending ? { ...current, pending: false, failed: true } : current
    )), 10_000);
    return () => window.clearTimeout(timer);
  }, [privacy.pending]);

  return {
    session,
    connect,
    disconnect,
    sendInput,
    setHeldRelease,
    setArmedKeys,
    canvasRef,
    frameSize,
    codecSupport,
    decoderError,
    stats,
    quality,
    audio,
    startAudio,
    stopAudio,
    setAudioVolume,
    clipboardFallback,
    clipboardSync: syncEnabled,
    toggleClipboardSync,
    syncClipboardNow,
    syncPastedClipboard,
    noteClipboardCopied,
    clipboardSyncNeedsRead,
    sendClipboard,
    pasteLocalClipboard,
    dismissClipboard,
    privacy,
    togglePrivacy,
    restartNotice,
    requestRestart,
    reconnectAttempt,
    cancelReconnect,
    chatLines,
    sendChat,
    twoFactor,
    submitTwoFactor,
  };
}
