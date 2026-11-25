import { selectCodecs } from '../../../server/control';
import { decodeEndpoint, encodeEndpoint, MAX_CANDIDATES, sdpFingerprint, validateCandidate } from '../../../shared/webrtc';
import { loginWebRtc, verifiedPeerKey, type ConnectRequest } from './handshake';
import { DataChannelStream } from './stream';
import type { NativeConnection } from './session';

const ROUTE_STATS_TIMEOUT_MS = 300;
const DIRECT_CANDIDATE_TYPES = new Set(['host', 'srflx', 'prflx']);

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
    let remoteCount = 0;
    let signalChain = Promise.resolve();
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
      if (!settled) { settled = true; reject(error); }
      else stream.fail(error);
      dispose();
    };
    const cancel = () => fail(new DOMException('Connection cancelled', 'AbortError'));
    abort.addEventListener('abort', cancel, { once: true });
    if (abort.aborted) { cancel(); return; }
    const sendCandidate = (candidate: string) => {
      if (signal.readyState === WebSocket.OPEN) signal.send(JSON.stringify({ type: 'candidate', candidate }));
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
      const candidate = JSON.stringify(event.candidate.toJSON());
      if (signalingReady) sendCandidate(candidate);
      else localCandidates.push(candidate);
    };
    signal.onopen = () => {
      void (async () => {
        const offer = await pc.createOffer();
        if (disposed) return;
        await pc.setLocalDescription(offer);
        if (disposed) return;
        signal.send(JSON.stringify({ type: 'offer', offer: encodeEndpoint({ type: 'offer', sdp: offer.sdp! }),
          peerId: request.peerId!.replace(/\s/g, ''), idServer: request.idServer,
          key: request.key ?? '', token: request.token ?? '' }));
      })().catch(fail);
    };
    signal.onmessage = event => {
      signalChain = signalChain.then(async () => {
        if (disposed || verified) return;
        const message = JSON.parse(event.data);
        if (message.type === 'error') {
          if (answered) return;
          throw new Error(message.message || 'WebRTC signaling failed');
        }
        if (message.type === 'ready') {
          signalingReady = true;
          localCandidates.splice(0).forEach(sendCandidate);
        } else if (message.type === 'answer' && !answered) {
          const answer = decodeEndpoint(message.answer, 'answer');
          fingerprint = sdpFingerprint(answer.sdp);
          peerKey = verifiedPeerKey(message.signedPk, request.key ?? '', request.peerId!.replace(/\s/g, ''));
          await pc.setRemoteDescription(answer);
          answered = true;
          for (const candidate of remoteCandidates.splice(0)) await pc.addIceCandidate(JSON.parse(candidate));
          beginLogin();
        } else if (message.type === 'candidate' && ++remoteCount <= MAX_CANDIDATES) {
          const candidate = validateCandidate(message.candidate);
          if (answered) await pc.addIceCandidate(JSON.parse(candidate));
          else remoteCandidates.push(candidate);
        }
      }).catch(fail);
    };
    signal.onerror = () => { if (!answered && !disposed) fail(new Error('WebRTC signaling unavailable')); };
    // Some ID servers close the signaling TCP stream after the answer. Allow gathered ICE to finish.
    signal.onclose = () => { if (!answered && !disposed) fail(new Error('WebRTC signaling closed')); };
  });
}
