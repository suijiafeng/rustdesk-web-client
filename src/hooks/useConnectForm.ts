import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ErrorPayload } from '../../shared/errors';
import type { ServerSettings } from '../components/settings/IdServerModal';
import { deviceKeyFor, formatPeerId, type SavedDevice } from '../lib/devices';
import type { Locale } from '../lib/i18n';
import { getSavedPassword, type SavedPasswordMap } from '../lib/passwords';
import type { ConnectionField, ConnectionMode, ConnectionPhase, ConnectRequest } from '../types';
import type { AutoReconnectState } from './useAutoReconnect';

export interface ConnectFormProps {
  locale: Locale;
  mode: ConnectionMode;
  directIpEnabled: boolean;
  phase: ConnectionPhase;
  host: string;
  port: string;
  password: string;
  peerId: string;
  idServer: string;
  relayServer: string;
  serverKey: string;
  forceRelay: boolean;
  gatewayToken: string;
  gatewayTokenNeedsInput: boolean;
  detail: string;
  connectionError?: ErrorPayload;
  decoderError: string;
  autoReconnect?: AutoReconnectState | null;
  onCancelAutoReconnect?: () => void;
  devices?: SavedDevice[];
  savedPasswords: SavedPasswordMap;
  onChangeMode: (mode: ConnectionMode) => void;
  onChangeField: (field: ConnectionField, value: string) => void;
  onClearSavedPassword: (deviceKey: string) => void;
  onSelectDevice: (device: SavedDevice) => void;
  onConnect: (req?: ConnectRequest) => void;
  onDisconnect: () => void;
  onDismissError: () => void;
  openNetworkServerSetup: (continueConnection?: boolean) => void;
}

// Keep this hook in the shell so opening settings preserves the connection form state.
export function useConnectForm(props: ConnectFormProps) {
  const {
    mode,
    directIpEnabled,
    phase,
    host,
    port,
    password,
    peerId,
    idServer,
    relayServer,
    serverKey,
    forceRelay,
    gatewayToken,
    gatewayTokenNeedsInput,
    savedPasswords,
    onChangeField,
    onSelectDevice,
    onConnect,
    openNetworkServerSetup,
  } = props;
  const [helpHover, setHelpHover] = useState(false);
  const [helpPinned, setHelpPinned] = useState(false);
  const helpVisible = helpHover || helpPinned;

  const [heroInputError, setHeroInputError] = useState(false);
  const [heroErrorShake, setHeroErrorShake] = useState(false);
  const [rememberPassword, setRememberPassword] = useState(false);
  const [promptGatewayToken, setPromptGatewayToken] = useState('');
  const [passwordPromptOpen, setPasswordPromptOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<ConnectionMode>(mode);
  const pendingConnectionRef = useRef<ConnectRequest | null>(null);
  const submittedConnectionRef = useRef<ConnectRequest | null>(null);

  const peerInputRef = useRef<HTMLInputElement>(null);
  const hostInputRef = useRef<HTMLInputElement>(null);
  const helpAnchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!helpVisible) return;
    const handlePointerDown = (ev: PointerEvent) => {
      if (helpAnchorRef.current && !helpAnchorRef.current.contains(ev.target as Node)) {
        setHelpPinned(false);
        setHelpHover(false);
      }
    };
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setHelpPinned(false);
        setHelpHover(false);
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [helpVisible]);

  const isLive = phase === 'live';
  const isConnecting = phase === 'connecting';
  const activeMode: ConnectionMode = directIpEnabled ? mode : 'id';

  const formattedIdValue = useMemo(() => {
    const clean = peerId.replace(/\s+/g, '');
    if (/^\d+$/.test(clean) && clean.length > 3) {
      return clean.replace(/(\d{3})(?=\d)/g, '$1 ');
    }
    return peerId;
  }, [peerId]);

  const activeTargetLabel =
    pendingMode === 'id'
      ? formatPeerId(peerId)
      : `${host.trim()}${port.trim() && port.trim() !== '21118' ? `:${port.trim()}` : ''}`;

  const triggerHeroInputError = () => {
    setHeroInputError(true);
    setHeroErrorShake(false);
    window.requestAnimationFrame(() => setHeroErrorShake(true));
  };

  const pendingDeviceKey = deviceKeyFor({
    mode: pendingMode,
    peerId,
    host,
    port,
  });

  const beginConnection = (request: ConnectRequest) => {
    const requestedMode = request.mode ?? activeMode;
    pendingConnectionRef.current = request;
    setHeroInputError(false);
    setHeroErrorShake(false);
    setPendingMode(requestedMode);
    const key = deviceKeyFor({
      mode: requestedMode, peerId: request.peerId ?? peerId,
      host: request.host ?? host, port: request.port ?? port,
    });
    const saved = getSavedPassword(savedPasswords, key);
    onChangeField('password', saved);
    if (saved && !gatewayTokenNeedsInput) {
      setPasswordPromptOpen(false);
      const submitted = { ...request, mode: requestedMode, password: saved, remember: true };
      submittedConnectionRef.current = submitted;
      onConnect(submitted);
      return;
    }
    setRememberPassword(Boolean(saved));
    setPromptGatewayToken(gatewayToken);
    setPasswordPromptOpen(true);
  };

  useEffect(() => {
    const submitted = submittedConnectionRef.current;
    if (phase !== 'error' || !submitted ||
        !['PASSWORD_INVALID', 'PASSWORD_REQUIRED'].includes(props.connectionError?.code ?? '')) return;
    // Only a password rejection needs another password prompt. Network errors
    // must not force valid saved credentials through an extra confirmation.
    submittedConnectionRef.current = null;
    pendingConnectionRef.current = submitted;
    setPendingMode(submitted.mode ?? activeMode);
    onChangeField('password', '');
    setRememberPassword(submitted.remember === true);
    setPromptGatewayToken(gatewayToken);
    setPasswordPromptOpen(true);
  }, [phase, props.connectionError]);

  const requestConnection = (request: ConnectRequest) => {
    if (isConnecting || isLive) return;
    const requestedMode = request.mode ?? activeMode;
    if (requestedMode === 'id') {
      if (!(request.peerId ?? peerId).replace(/\s+/g, '')) {
        triggerHeroInputError();
        peerInputRef.current?.focus();
        return;
      }
      if (!(request.idServer ?? idServer).trim()) {
        pendingConnectionRef.current = request;
        setPendingMode(requestedMode);
        openNetworkServerSetup(true);
        return;
      }
    } else if (!(request.host ?? host).trim()) {
      triggerHeroInputError();
      hostInputRef.current?.focus();
      return;
    }
    beginConnection(request);
  };
  const retryConnection = () => requestConnection({ mode: activeMode, peerId, host, port });
  const handleHeroSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    retryConnection();
  };
  const continueAfterServerSetup = (settings: ServerSettings) => {
    const request = pendingConnectionRef.current;
    if (request) beginConnection({ ...request, ...settings });
  };
  const cancelServerSetup = () => {
    pendingConnectionRef.current = null;
  };

  const handleDeviceRowTap = (device: SavedDevice) => {
    onSelectDevice(device);
    requestConnection({
      mode: device.mode, peerId: device.peerId, idServer: device.idServer || idServer,
      relayServer: device.relayServer ?? relayServer, serverKey: device.serverKey ?? serverKey,
      forceRelay: device.forceRelay ?? forceRelay, host: device.host, port: device.port || '21118',
    });
  };

  const handleConfirmPasswordConnect = (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordPromptOpen(false);
    const submitted = {
      ...pendingConnectionRef.current,
      mode: pendingMode,
      password,
      remember: rememberPassword,
      gatewayToken: gatewayTokenNeedsInput ? promptGatewayToken : undefined,
    };
    submittedConnectionRef.current = submitted;
    onConnect(submitted);
  };

  const handleIdInputChange = (raw: string) => {
    setHeroInputError(false);
    const digitsOnly = raw.replace(/\s+/g, '');
    onChangeField('peerId', /^\d*$/.test(digitsOnly) ? digitsOnly : raw);
  };

  return {
    ...props,
    isLive,
    isConnecting,
    activeMode,
    formattedIdValue,
    helpAnchorRef,
    helpVisible,
    helpPinned,
    setHelpPinned,
    setHelpHover,
    heroInputError,
    heroErrorShake,
    setHeroErrorShake,
    setHeroInputError,
    peerInputRef,
    hostInputRef,
    handleIdInputChange,
    handleHeroSubmit,
    retryConnection,
    continueAfterServerSetup,
    cancelServerSetup,
    setPromptGatewayToken,
    setPasswordPromptOpen,
    handleDeviceRowTap,
    passwordPromptOpen,
    activeTargetLabel,
    rememberPassword,
    pendingDeviceKey,
    promptGatewayToken,
    setRememberPassword,
    handleConfirmPasswordConnect,
  };
}

export type ConnectFormModel = ReturnType<typeof useConnectForm>;
