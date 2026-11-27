import type { ErrorPayload } from '../../shared/errors';
import { lazy, Suspense, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { useClipboardSync } from '../hooks/useClipboardSync';
import type { useGatewaySession } from '../hooks/useGatewaySession';
import type { usePreferences } from '../hooks/usePreferences';
import type { useRemoteKeyboard } from '../hooks/useRemoteKeyboard';
import type { useRemotePointer } from '../hooks/useRemotePointer';
import type { useSavedDevices } from '../hooks/useSavedDevices';
import type { useVideoPipeline } from '../hooks/useVideoPipeline';
import type { useViewTransform } from '../hooks/useViewTransform';
import type { SoftKeyboardMode } from '../hooks/useKeyboardViewport';
import type { SavedDevice } from '../lib/devices';
import { persistDisplayPrefs, type DisplayPrefs } from '../lib/displayPrefs';
import type { DiagnosticsSummary } from '../lib/diagnostics';
import { t } from '../lib/i18n';
import type { ClientMessage, PeerMessage, QualityLevel, ServerMessage } from '../lib/protocol';
import type { ConnectionPhase } from '../types';
import type { MobilePanel } from './MobileSessionPanel';
import { RustDeskShell } from './RustDeskShell';
import { SoftKeyboardBar } from './SoftKeyboardBar';

const DiagnosticOverlay = lazy(() =>
  import('./DiagnosticOverlay').then((m) => ({ default: m.DiagnosticOverlay }))
);
const MobileDock = lazy(() =>
  import('./MobileDock').then((m) => ({ default: m.MobileDock }))
);
const SessionHandle = lazy(() =>
  import('./SessionHandle').then((m) => ({ default: m.SessionHandle }))
);
const SessionMenu = lazy(() =>
  import('./SessionMenu').then((m) => ({ default: m.SessionMenu }))
);

type Setter<T> = Dispatch<SetStateAction<T>>;

interface SessionPanelsProps {
  preferences: ReturnType<typeof usePreferences>;
  savedDevices: ReturnType<typeof useSavedDevices>;
  viewport: ReturnType<typeof useViewTransform>;
  video: ReturnType<typeof useVideoPipeline>;
  keyboard: ReturnType<typeof useRemoteKeyboard>;
  pointer: ReturnType<typeof useRemotePointer>;
  gateway: ReturnType<typeof useGatewaySession>;
  clipboard: ReturnType<typeof useClipboardSync>;
  connection: {
    phase: ConnectionPhase;
    detail: string;
  connectionError?: ErrorPayload;
    peer: PeerMessage | null;
    password: string;
    setPassword: Setter<string>;
    authRequired: boolean;
    handleSelectDevice: (device: SavedDevice) => void;
    handleUpdateDisplayPrefs: (patch: Partial<DisplayPrefs>) => void;
    handleResetDefaults: () => void;
  };
  controls: {
    send: (message: ClientMessage) => void;
    display: number;
    setDisplay: Setter<number>;
    resolutionOptions: Extract<ServerMessage, { type: 'resolutions' }> | null;
    quality: QualityLevel;
    setQuality: Setter<QualityLevel>;
    targetFps: number;
    setTargetFps: Setter<number>;
    privacyEnabled: boolean;
    privacyPending: boolean;
    setPrivacyPending: Setter<boolean>;
    clipboardSync: boolean;
    clipboardAllowed: boolean;
    toggleClipboardSync: () => void;
    audioEnabled: boolean;
    toggleAudio: () => Promise<void>;
    showCtrlAltDel: boolean;
  };
  chrome: {
    handleX: number;
    setHandleX: Setter<number>;
    toolbarExpanded: boolean;
    setToolbarExpanded: Setter<boolean>;
    toolbarPinned: boolean;
    setToolbarPinned: Setter<boolean>;
    mobilePanel: MobilePanel;
    setMobilePanel: Setter<MobilePanel>;
    menuOpen: boolean;
    setMenuOpen: Setter<boolean>;
    connectDialog: boolean;
    setConnectDialog: Setter<boolean>;
    softKeys: boolean;
    softKeyboardMode: SoftKeyboardMode;
    softKeyboardInputRef: RefObject<HTMLInputElement | null>;
    closeChrome: () => void;
    toggleSoftKeyboard: () => void;
    switchSoftKeyboard: (mode: SoftKeyboardMode) => void;
    hideSoftKeyboard: () => void;
    isMobileViewport: boolean;
    isCoarseDevice: boolean;
    isTouchLayout: boolean;
    remoteInput: boolean;
    isFullscreen?: boolean;
    toggleFullscreen?: () => void;
  };
  notices: {
    restartState: 'requested' | 'waiting' | null;
    setRestartState: Setter<'requested' | 'waiting' | null>;
    sessionTip: { text: string; error: boolean } | null;
    showSessionTip: (text: string, error?: boolean) => void;
    webRtcFallbackReason: string | null;
    setWebRtcFallbackReason: Setter<string | null>;
  };
  diagnostics: {
    diagnosticsOpen: boolean;
    setDiagnosticsOpen: Setter<boolean>;
    diagSummary: DiagnosticsSummary;
    rtt: number;
    gatewayVideo: Extract<ServerMessage, { type: 'pong' }>['gatewayVideo'];
  };
}

export function SessionPanels({
  preferences, savedDevices, viewport, video, keyboard, pointer, gateway, clipboard,
  connection, controls, chrome, notices, diagnostics,
}: SessionPanelsProps) {
  const {
    locale, localePreference, theme, displayPrefs, setDisplayPrefs, displayPrefsRef,
    changeLocale, changeTheme, mode, directIpEnabled, host, port, peerId, idServer,
    relayServer, serverKey, forceRelay, setMode, handleToggleDirectIp, setHost, setPort,
    setPeerId, setIdServer, setRelayServer, setServerKey, setForceRelay,
    webRtcOptIn, setWebRtcOptIn,
  } = preferences;
  const {
    savedGatewayToken, gatewayToken, gatewayTokenReady, gatewayTokenRejected,
    gatewayTokenReadFailed, saveGatewayToken, devices, savedPasswords, passwordsReady,
    passwordStorageFailed, setPasswordStorageFailed, handleClearSavedPassword,
    handleClearAllSavedPasswords, handleToggleFavorite, handleRenameDevice, handleRemoveDevice,
  } = savedDevices;
  const { pageZoomed, resetPageZoom, box, viewMode, setViewMode, setPan, setZoom, remoteW, remoteH, keyboardLayout, visibleViewport } = viewport;
  const { statsStore, decoderError } = video;
  const { sendText, sendChord, handleQuickKey } = keyboard;
  const { touchMode, handleToggleTouchMode } = pointer;
  const { connectSession, disconnect, requestRestart, handleDismissError, codecSupport } = gateway;
  const { phase, detail, connectionError, peer, password, setPassword, authRequired, handleSelectDevice, handleUpdateDisplayPrefs, handleResetDefaults } = connection;
  const {
    send, display, setDisplay, resolutionOptions, quality, setQuality, targetFps, setTargetFps,
    privacyEnabled, privacyPending, setPrivacyPending, clipboardSync, clipboardAllowed,
    toggleClipboardSync, audioEnabled, toggleAudio, showCtrlAltDel,
  } = controls;
  const {
    handleX, setHandleX, toolbarExpanded, setToolbarExpanded, toolbarPinned, setToolbarPinned,
    mobilePanel, setMobilePanel, menuOpen, setMenuOpen, connectDialog, setConnectDialog,
    softKeys, softKeyboardMode, softKeyboardInputRef, closeChrome, toggleSoftKeyboard,
    switchSoftKeyboard, hideSoftKeyboard, isMobileViewport, isCoarseDevice, isTouchLayout, remoteInput,
    isFullscreen, toggleFullscreen,
  } = chrome;
  const { restartState, setRestartState, sessionTip, showSessionTip, webRtcFallbackReason, setWebRtcFallbackReason } = notices;
  const { diagnosticsOpen, setDiagnosticsOpen, diagSummary, rtt, gatewayVideo } = diagnostics;
  const showConnectSheet = phase !== 'live' || connectDialog;
  const showSessionMenu = menuOpen && phase === 'live' && !connectDialog;
  const showHandle = phase === 'live' && !connectDialog && !menuOpen && !isTouchLayout;
  const showMobileDock = phase === 'live' && !connectDialog && !softKeys && isTouchLayout;
  const liveHostTitle =
    peer?.hostname || peer?.username || (mode === 'id' ? peerId : host) || 'Remote';
  const routeLabel = t(locale, peer?.route === 'webrtc-relay' ? 'routeWebRtcRelay' : peer?.route === 'webrtc' ? 'routeWebRtcUnknown' : peer?.route === 'webrtc-direct' ? 'routeWebRtc' : peer?.route === 'relay' ? 'routeRelay' : peer?.route === 'direct' ? 'routeDirect' : 'routeUnknown');
  const stageViewport = keyboardLayout.viewport ?? visibleViewport;

  return (
    <>
      {pageZoomed && (
        <div
          className="page-zoom-banner"
          data-testid="page-zoom-banner"
          role="status"
          onPointerDown={(e) => e.stopPropagation()}
        >
          <span>{t(locale, 'pageZoomedBanner')}</span>
          <button
            type="button"
            className="rd-btn primary"
            style={{ minHeight: 32, padding: '4px 10px' }}
            data-testid="page-zoom-reset"
            onClick={resetPageZoom}
          >
            {t(locale, 'reset')}
          </button>
        </div>
      )}

      {showHandle && (
        <Suspense fallback={null}>
          <SessionHandle
            locale={locale}
            handleX={handleX}
            stageWidth={box.w}
            expanded={toolbarExpanded}
            pinned={toolbarPinned}
            hostTitle={liveHostTitle}
            rtt={rtt}
            diagnosticsOpen={diagnosticsOpen}
            displays={peer?.displays ?? []}
            activeDisplay={display}
            viewMode={viewMode}
            audioEnabled={audioEnabled}
            isFullscreen={isFullscreen}
            hasWarning={Boolean(decoderError)}
            onMoveHandle={setHandleX}
            onSetExpanded={setToolbarExpanded}
            onTogglePinned={() => setToolbarPinned((prev) => !prev)}
            onToggleDiagnostics={() => setDiagnosticsOpen((prev) => !prev)}
            onSwitchDisplay={(idx) => {
              setDisplay(idx);
              send({ type: 'switchDisplay', display: idx });
            }}
            onToggleViewMode={() => {
              if (viewMode === 'fit') {
                setViewMode('original');
                setPan({
                  panX: (box.w - remoteW) / 2,
                  panY: (box.h - remoteH) / 2,
                });
              } else {
                setViewMode('fit');
                setZoom(1);
                setPan({ panX: 0, panY: 0 });
              }
            }}
            onToggleFullscreen={toggleFullscreen}
            onToggleAudio={() => { void toggleAudio(); }}
            onToggleKeyboard={toggleSoftKeyboard}
            onCtrlAltDel={showCtrlAltDel && !displayPrefs.viewOnly ? () => handleQuickKey('Ctrl+Alt+Del') : undefined}
            onOpenMenu={() => setMenuOpen(true)}
            onDisconnect={disconnect}
          />
        </Suspense>
      )}

      {restartState && <div className="restart-notice" role="status">
        {t(locale, restartState === 'requested' ? 'restartWaiting' : 'retryWaiting')}
        <button type="button" onClick={restartState === 'requested' ? () => setRestartState(null) : disconnect}>{t(locale,'cancel')}</button>
      </div>}

      {diagnosticsOpen && phase === 'live' && (
        <Suspense fallback={null}>
          <DiagnosticOverlay
            locale={locale}
            statsStore={statsStore}
            summary={diagSummary}
            routeLabel={routeLabel}
            browserDirect={peer?.route?.startsWith('webrtc')}
            encrypted={peer?.encrypted}
            preferredCodec={displayPrefs.codec}
            gatewayVideo={gatewayVideo}
            onClose={() => setDiagnosticsOpen(false)}
          />
        </Suspense>
      )}

      {(phase === 'live' || webRtcFallbackReason !== null) && (
        <div className="session-tip-region" aria-live="polite" aria-atomic="true">
          {webRtcFallbackReason !== null && (
            <div className="session-tip fallback-tip" data-testid="webrtc-fallback-tip" data-session-notice
              onPointerDown={e => e.stopPropagation()} onPointerUp={e => e.stopPropagation()}
              onPointerMove={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
              <span>{t(locale, 'webRtcFallback')}<br />{webRtcFallbackReason}</span>
              <button type="button" data-testid="webrtc-fallback-dismiss" aria-label={t(locale, 'close')}
                onClick={() => setWebRtcFallbackReason(null)}>×</button>
            </div>
          )}
          {phase === 'live' && sessionTip && <div className="session-tip" data-testid="session-tip">{sessionTip.text}</div>}
          {phase === 'live' && clipboardSync && clipboardAllowed && clipboard.pending && (
            <div className="session-tip clipboard-tip" data-testid="clipboard-tip"
              onPointerDown={e => e.stopPropagation()} onClick={e => e.stopPropagation()}>
              <span>{t(locale, clipboard.pending === 'write' ? 'clipRemoteReady' : 'clipLocalReady')}</span>
              <button type="button" onClick={() => { void (clipboard.pending === 'write' ? clipboard.writeRemote() : clipboard.readLocal()); }}>
                {t(locale, clipboard.pending === 'write' ? 'copy' : 'clipSyncAction')}
              </button>
              <button type="button" aria-label={t(locale, 'close')} onClick={clipboard.dismiss}>×</button>
            </div>
          )}
        </div>
      )}
      {showMobileDock && (
        <Suspense fallback={null}>
          <MobileDock
            locale={locale}
            activePanel={menuOpen ? mobilePanel : null}
            touchMode={touchMode}
            diagnosticsOpen={diagnosticsOpen}
            onToggleDiagnostics={() => {
              setMobilePanel('toolbar');
              setDiagnosticsOpen((prev) => !prev);
            }}
            onToggleTouchMode={() => {
              handleToggleTouchMode();
              setMobilePanel('toolbar');
            }}
            onToggleKeyboard={toggleSoftKeyboard}
            onCollapse={closeChrome}
            onOpenMenu={panel => {
              setDiagnosticsOpen(false);
              setMobilePanel(current => menuOpen && panel === current ? 'toolbar' : panel);
              setMenuOpen(true);
            }}
          />
        </Suspense>
      )}

      {passwordStorageFailed && <div className="restart-notice" role="alert">{t(locale, 'passwordStorageFailed')} <button onClick={() => setPasswordStorageFailed(false)}>OK</button></div>}
      {showConnectSheet && passwordsReady && gatewayTokenReady && (
        <RustDeskShell
          locale={locale}
          localePreference={localePreference}
          isDesktop={!(isMobileViewport || (isCoarseDevice && box.h > 0 && box.h <= 540 && box.w > box.h))}
          theme={theme}
          displayPrefs={displayPrefs}
          onChangeLocale={changeLocale}
          onChangeTheme={changeTheme}
          onUpdateDisplayPrefs={handleUpdateDisplayPrefs}
          mode={mode}
          directIpEnabled={directIpEnabled}
          webRtcOptIn={webRtcOptIn}
          phase={phase}
          host={host}
          port={port}
          password={password}
          peerId={peerId}
          idServer={idServer}
          relayServer={relayServer}
          serverKey={serverKey}
          forceRelay={forceRelay}
          gatewayToken={gatewayToken}
          savedGatewayToken={savedGatewayToken}
          gatewayTokenNeedsInput={authRequired && (!gatewayToken.trim() || gatewayTokenRejected)}
          gatewayTokenReadFailed={gatewayTokenReadFailed}
          onSaveGatewayToken={saveGatewayToken}
          detail={detail}
          connectionError={connectionError}
          decoderError={decoderError}
          autoReconnect={gateway.autoReconnect}
          onCancelAutoReconnect={gateway.cancelAutoReconnect}
          touchMode={touchMode}
          diagnosticsOpen={diagnosticsOpen}
          devices={devices}
          savedPasswords={savedPasswords}
          onChangeMode={setMode}
          onToggleDirectIp={handleToggleDirectIp}
          onChangeWebRtcOptIn={setWebRtcOptIn}
          onChangeField={(field, val) => {
            if (field === 'host') setHost(val);
            else if (field === 'port') setPort(val);
            else if (field === 'password') setPassword(val);
            else if (field === 'peerId') setPeerId(val);
            else if (field === 'idServer') setIdServer(val);
            else if (field === 'relayServer') setRelayServer(val);
            else if (field === 'serverKey') setServerKey(val);
          }}
          onChangeForceRelay={setForceRelay}
          onClearSavedPassword={handleClearSavedPassword}
          onClearAllSavedPasswords={handleClearAllSavedPasswords}
          onResetDefaults={handleResetDefaults}
          onSelectDevice={handleSelectDevice}
          onToggleFavorite={handleToggleFavorite}
          onRenameDevice={handleRenameDevice}
          onRemoveDevice={handleRemoveDevice}
          onToggleTouchMode={handleToggleTouchMode}
          onToggleDiagnostics={() => setDiagnosticsOpen((prev) => !prev)}
          onConnect={(req) => void connectSession(req)}
          onDisconnect={disconnect}
          onDismissError={handleDismissError}
          onClose={closeChrome}
        />
      )}

      {showSessionMenu && (
        <Suspense fallback={null}>
          <SessionMenu
            clipboardSync={clipboardSync && clipboardAllowed}
            clipboardAllowed={clipboardAllowed}
            onToggleClipboardSync={toggleClipboardSync}
            onNotify={showSessionTip}
            onRestart={requestRestart}
            mobilePanel={mobilePanel}
            locale={locale}
            audioEnabled={audioEnabled}
            onToggleAudio={toggleAudio}
            mobileLayout={isTouchLayout}
            followWindow={displayPrefs.followWindow}
            onToggleFollowWindow={() => handleUpdateDisplayPrefs({ followWindow: !displayPrefs.followWindow })}
            phase={phase}
            peer={peer}
            decoderError={decoderError}
            display={display}
            touchMode={touchMode}
            viewOnly={displayPrefs.viewOnly}
            sizes={resolutionOptions?.display === display ? resolutionOptions.sizes : []}
            onResolution={(width, height) => send({ type: 'resolution', display, width, height })}
            diagnosticsOpen={diagnosticsOpen}
            statsStore={statsStore}
            rtt={rtt}
            quality={quality}
            customQuality={displayPrefs.customBitrate}
            targetFps={targetFps}
            preferredCodec={displayPrefs.codec}
            codecSupport={codecSupport}
            privacyEnabled={privacyEnabled}
            privacyPending={privacyPending}
            onTogglePrivacy={() => {
              if (!peer?.privacyAllowed || privacyPending || displayPrefs.viewOnly) return;
              setPrivacyPending(true);
              showSessionTip(t(locale, 'privacyWaiting'));
              send({ type: 'privacy', enabled: !privacyEnabled });
            }}
            onClose={closeChrome}
            onOpenConnection={() => {
              setMenuOpen(false);
              setConnectDialog(true);
            }}
            onDisconnect={disconnect}
            onToggleDiagnostics={() => {
              setDiagnosticsOpen(true);
              setMenuOpen(false);
            }}
            onToggleTouchMode={handleToggleTouchMode}
            reverseScroll={displayPrefs.reverseMouseWheel}
            onReverseScrollChange={reverseMouseWheel => handleUpdateDisplayPrefs({ reverseMouseWheel })}
            onSwitchDisplay={(idx) => {
              setDisplay(idx);
              send({ type: 'switchDisplay', display: idx });
            }}
            onQuickKey={handleQuickKey}
            onChangeQuality={(q, fps, nextCodec, customQuality) => {
              setQuality(q);
              setTargetFps(fps);
              const activeCodec = nextCodec ?? displayPrefsRef.current.codec;
              const ratio = customQuality ?? displayPrefsRef.current.customBitrate;
              setDisplayPrefs(prev => {
                const updated = { ...prev, qualityPreset: q, targetFps: fps, codec: activeCodec, customBitrate: ratio };
                persistDisplayPrefs(updated);
                return updated;
              });
              send({ type: 'quality', quality: q, customQuality: q === 'custom' ? ratio : undefined, fps, codec: activeCodec });
            }}
          />
        </Suspense>
      )}

      {softKeys && remoteInput && (
        <SoftKeyboardBar
          onPasteText={clipboardSync && clipboardAllowed ? text => { clipboard.sendLocal(text); } : undefined}
          locale={locale}
          remotePlatform={peer?.platform}
          inputRef={softKeyboardInputRef}
          mode={softKeyboardMode}
          reservedSpace={keyboardLayout.reservedSpace}
          viewportHeight={stageViewport?.height ?? box.h}
          onSwitchMode={switchSoftKeyboard}
          onSendText={sendText}
          onSendControl={(action, control) => send({ type: 'key', action, control })}
          onSendChord={sendChord}
          onHide={hideSoftKeyboard}
        />
      )}
    </>
  );
}
