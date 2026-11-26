import { selectCodecs } from '../../../shared/control.ts';
import { decodeEndpoint, encodeEndpoint, MAX_CANDIDATES, sdpFingerprint, validateCandidate } from '../../../shared/webrtc';
import { loginWebRtc, verifiedPeerKey, type ConnectRequest } from './handshake';
import { DataChannelStream } from './stream';
import type { NativeConnection } from './session';

const ROUTE_STATS_TIMEOUT_MS = 300;
const DIRECT_CANDIDATE_TYPES = new Set(['host', 'srflx', 'prflx']);
// These failures will also reject the gateway route. Never repeat credentials or
// downgrade identity verification by trying a second transport after them.
const TERMINAL_FAILURE_REASONS = new Set([
  'The gateway access token is missing or incorrect.', 'Too many failed attempts. Try again shortly.',
  'Invalid ID server or peer ID', 'ID does not exist', 'remote desktop is offline', 'key mismatch', 'key overuse',
  'That target address is not allowed.', 'That target port is not allowed.',
  'Invalid identity server key', 'server public key must be 32 bytes of standard base64',
  'key mismatch: rendezvous server key signature is invalid',
  'missing signed_params in rendezvous KeyExchange', 'invalid signed_params signature in rendezvous KeyExchange',
  'invalid signed_params domain prefix', 'signed_params mismatch in rendezvous KeyExchange',
  'WebRTC peer did not provide its signed identity', 'WebRTC peer signature verification failed',
  'WebRTC peer identity is malformed',
  'WebRTC peer identity mismatch', 'WebRTC certificate does not match the signed peer identity',
  'Invalid WebRTC certificate fingerprint',
]);
// Only fixed protocol errors are safe to include; browser SDP errors and server text may contain addresses or credentials.
const SAFE_FAILURE_REASONS = new Set([
  ...TERMINAL_FAILURE_REASONS,
  'WebRTC connection timed out', 'WebRTC connection failed',
  'WebRTC signaling unavailable', 'WebRTC signaling closed', 'WebRTC signaling failed', 'WebRTC signaling timed out',
  'WebRTC peer response timed out', 'WebRTC peer closed during identity verification',
  'WebRTC peer closed before login',
  'Invalid WebRTC endpoint', 'Invalid WebRTC session description', 'Invalid ICE candidate',
  'WebRTC data channel failed', 'WebRTC channel is closed', 'WebRTC send timed out',
  'ID server closed WebRTC signaling', 'This peer or ID server did not offer WebRTC',
  'Incompatible ID server', 'punch hole failed',
  'Invalid signaling message', 'Send a WebRTC offer first', 'Unexpected ICE candidate',
  'host closed the connection', 'timed out waiting for host response',
  'rendezvous server closed connection during key exchange',
]);
const SAFE_ERROR_NAMES = new Set([
  'Error', 'EvalError', 'TypeError', 'SyntaxError', 'RangeError', 'OperationError',
  'InvalidStateError', 'InvalidAccessError', 'NotSupportedError', 'NotAllowedError', 'NetworkError', 'SecurityError',
]);

export async function readWebRtcRoute(
  pc: Pick<RTCPeerConnection, 'getStats'>,
  timeoutMs = ROUTE_STATS_TIMEOUT_MS,
): Promise<NativeConnection['route']> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<null>(resolve => {
      timer = setTimeout(() => resolve(null), timeoutMs);
    });
    const stats = await Promise.race([pc.getStats(), timeout]);
    if (!stats) return 'webrtc';

    let pair: { localCandidateId: string; remoteCandidateId: string } | undefined;
    let nominatedPair: typeof pair;
    stats.forEach(report => {
      if (report.type === 'transport' && report.selectedCandidatePairId) {
        pair = stats.get(report.selectedCandidatePairId) ?? pair;
      } else if (report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded') {
        nominatedPair = report;
      }
    });
    const selected = pair ?? nominatedPair;
    if (!selected) return 'webrtc';

    const local = stats.get(selected.localCandidateId)?.candidateType;
    const remote = stats.get(selected.remoteCandidateId)?.candidateType;
    if (local === 'relay' || remote === 'relay') return 'webrtc-relay';
    return DIRECT_CANDIDATE_TYPES.has(local) && DIRECT_CANDIDATE_TYPES.has(remote)
      ? 'webrtc-direct'
      : 'webrtc';
  } catch {
    // Route statistics are optional after the peer has authenticated.
    return 'webrtc';
  } finally {
    clearTimeout(timer);
  }
}

export function connectWebRtc(url: string, request: ConnectRequest, abort: AbortSignal) {
  return new Promise<Awaited<ReturnType<typeof loginWebRtc>>>((resolve, reject) => {
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.cloudflare.com:3478' }] });
    const channel = pc.createDataChannel('bootstrap', { ordered: true });
    const stream = new DataChannelStream(channel);
    const signalUrl = new URL(url);
    signalUrl.pathname = signalUrl.pathname.replace(/\/$/, '') + '/webrtc';
    const signal = new WebSocket(signalUrl);
    let signalingReady = false;
    let answered = false;
    let open = false;
    let loggingIn = false;
    let verified = false;
    let settled = false;
    let disposed = false;
    let fingerprint = '';
    let peerKey: Uint8Array;
    const localCandidates: string[] = [];
    const remoteCandidates: string[] = [];
    let localCount = 0;
    let localSent = 0;
    let remoteCount = 0;
    let remoteApplied = 0;
    let phase = 'opening signaling';
    let signalServerError = false;
    let signalTransportError = false;
    let signalCloseCode: number | undefined;
    let signalChain = Promise.resolve();
    const diagnosticError = (error: unknown) => {
      // Keep cancellation and password-rejection semantics, including the no-second-login rule.
      if ((error instanceof Error || error instanceof DOMException) &&
          (error.name === 'AbortError' || error.name === 'WebRtcLoginError')) return error;
      const iceConnected = pc.iceConnectionState === 'connected' || pc.iceConnectionState === 'completed' || pc.connectionState === 'connected';
      const stage = settled ? 'session' : loggingIn ? (verified ? 'host login' : 'peer identity')
        : answered ? (iceConnected ? 'data channel' : 'ICE') : phase;
      const source = error instanceof Error || error instanceof DOMException ? error : null;
      const errorClass = source && SAFE_ERROR_NAMES.has(source.name) ? source.name : 'Error';
      const unsafeEval = source?.name === 'EvalError' && /unsafe-eval/i.test(source.message) && /Content Security Policy|\bCSP\b/i.test(source.message);
      const reason = unsafeEval ? 'WebRTC blocked by Content Security Policy (unsafe-eval)'
        : source && SAFE_FAILURE_REASONS.has(source.message) ? source.message : `WebRTC ${stage} failed`;
      const context = [
        `stage=${stage}`, `local candidates gathered/sent=${localCount}/${localSent}`,
        `remote candidates received/applied=${remoteCount}/${remoteApplied}`,
        `ICE=${pc.iceConnectionState}`, `gathering=${pc.iceGatheringState}`,
        `PC=${pc.connectionState}`, `data channel=${channel.readyState}`,
        `signaling=${['connecting', 'open', 'closing', 'closed'][signal.readyState] ?? 'unknown'}`,
        `error class=${errorClass}`,
      ];
      if (signalServerError) context.push('signaling server error received');
      if (signalTransportError) context.push('signaling transport error');
      if (signalCloseCode !== undefined) context.push(`signaling close code=${signalCloseCode}`);
      const diagnostic = new Error(`${reason} [${context.join('; ')}]`);
      if ((source && TERMINAL_FAILURE_REASONS.has(source.message)) || phase === 'answer identity') {
        diagnostic.name = 'WebRtcTerminalError';
      }
      return diagnostic;
    };
    const timer = setTimeout(() => fail(new Error('WebRTC connection timed out')), 12_000);
    const dispose = () => {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      abort.removeEventListener('abort', cancel);
      signal.close();
      stream.close();
      pc.close();
    };
    const fail = (error: unknown) => {
      if (disposed) return;
      const diagnostic = diagnosticError(error);
      if (!settled) { settled = true; reject(diagnostic); }
      else stream.fail(diagnostic);
      dispose();
    };
    const cancel = () => fail(new DOMException('Connection cancelled', 'AbortError'));
    abort.addEventListener('abort', cancel, { once: true });
    if (abort.aborted) { cancel(); return; }
    const sendCandidate = (candidate: string) => {
      if (signal.readyState === WebSocket.OPEN) {
        signal.send(JSON.stringify({ type: 'candidate', candidate }));
        localSent++;
      }
    };
    const beginLogin = () => {
      if (!answered || !open || loggingIn || disposed) return;
      loggingIn = true;
      void loginWebRtc(stream, request, selectCodecs(request.codecs), peerKey, fingerprint, () => {
        verified = true;
        clearTimeout(timer);
        signal.close();
      }).then(async connection => {
        connection.route = await readWebRtcRoute(pc);
        if (disposed) return;
        settled = true;
        // Session cleanup owns the peer connection as well as the data channel.
        const closeStream = stream.close.bind(stream);
        stream.close = () => { closeStream(); dispose(); };
        resolve(connection);
      }).catch(fail);
    };
    channel.onopen = () => { open = true; beginLogin(); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') fail(new Error('WebRTC connection failed'));
    };
    pc.onicecandidate = event => {
      if (!event.candidate || disposed || ++localCount > MAX_CANDIDATES) return;
      try {
        const candidate = JSON.stringify(event.candidate.toJSON());
        if (signalingReady) sendCandidate(candidate);
        else localCandidates.push(candidate);
      } catch (error) { fail(error); }
    };
    signal.onopen = () => {
      phase = 'creating offer';
      void (async () => {
        const offer = await pc.createOffer();
        if (disposed) return;
        await pc.setLocalDescription(offer);
        if (disposed) return;
        signal.send(JSON.stringify({ type: 'offer', offer: encodeEndpoint({ type: 'offer', sdp: offer.sdp! }),
          peerId: request.peerId!.replace(/\s/g, ''), idServer: request.idServer,
          key: request.key ?? '', token: request.token ?? '' }));
        phase = 'waiting answer';
      })().catch(fail);
    };
    signal.onmessage = event => {
      signalChain = signalChain.then(async () => {
        if (disposed || verified) return;
        const message = JSON.parse(event.data);
        if (message.type === 'error') {
          signalServerError = true;
          if (answered) return;
          throw new Error(message.message || 'WebRTC signaling failed');
        }
        if (message.type === 'ready') {
          signalingReady = true;
          localCandidates.splice(0).forEach(sendCandidate);
        } else if (message.type === 'answer' && !answered) {
          phase = 'answer identity';
          const answer = decodeEndpoint(message.answer, 'answer');
          fingerprint = sdpFingerprint(answer.sdp);
          peerKey = verifiedPeerKey(message.signedPk, request.key ?? '', request.peerId!.replace(/\s/g, ''));
          phase = 'applying answer';
          await pc.setRemoteDescription(answer);
          answered = true;
          for (const candidate of remoteCandidates.splice(0)) {
            await pc.addIceCandidate(JSON.parse(candidate));
            remoteApplied++;
          }
          beginLogin();
        } else if (message.type === 'candidate' && ++remoteCount <= MAX_CANDIDATES) {
          const candidate = validateCandidate(message.candidate);
          if (answered) {
            await pc.addIceCandidate(JSON.parse(candidate));
            remoteApplied++;
          }
          else remoteCandidates.push(candidate);
        }
      }).catch(fail);
    };
    signal.onerror = () => {
      if (disposed || verified) return;
      signalTransportError = true;
      if (!answered) fail(new Error('WebRTC signaling unavailable'));
    };
    // Some ID servers close the signaling TCP stream after the answer. Allow gathered ICE to finish.
    signal.onclose = event => {
      if (disposed || verified) return;
      signalCloseCode = event.code;
      if (!answered) fail(new Error('WebRTC signaling closed'));
    };
  });
}
