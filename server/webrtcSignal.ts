import type { WebSocket } from 'ws';
import type { GatewayAdmission } from './admission.ts';
import { checkPort, RENDEZVOUS_PORT, tokenMatches } from './auth.ts';
import { EncryptedFramedStream } from './bytesCodec.ts';
import { punchHoleFailureMessage } from '../shared/control.ts';
import { secureRendezvous } from './handshake.ts';
import { decodeRendezvous, encodeRendezvous } from '../shared/protos.ts';
import { decodeEndpoint, MAX_CANDIDATES, sdpFingerprint, validateCandidate } from '../shared/webrtc.ts';

// This endpoint only forwards signaling. Passwords, media and control stay in the browser.
export function serveWebRtcSignal(ws: WebSocket, token: string, admission?: GatewayAdmission): () => void {
  let state: 'waiting' | 'dialing' | 'ready' | 'closed' = 'waiting';
  const connection = new AbortController();
  let stream: EncryptedFramedStream | null = null;
  let peerId = '';
  let sessionKey = '';
  let sentCandidates = 0;
  let receivedCandidates = 0;
  const retries = new Set<ReturnType<typeof setTimeout>>();
  const send = (value: object) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(value));
  };
  const close = () => {
    state = 'closed';
    connection.abort();
    clearTimeout(deadline);
    retries.forEach(clearTimeout);
    retries.clear();
    stream?.close();
    stream = null;
    if (ws.readyState === ws.OPEN) ws.close();
  };
  const fail = (error: unknown) => {
    if (state === 'closed') return;
    send({ type: 'error', message: error instanceof Error ? error.message : 'WebRTC signaling failed' });
    close();
  };
  const deadline = setTimeout(() => fail(new Error('WebRTC signaling timed out')), 20_000);
  deadline.unref?.();
  ws.on('close', close);
  ws.on('error', close);
  ws.on('message', (data, binary) => {
    void (async () => {
      if (state === 'closed') return;
      if (binary || Buffer.byteLength(data as Buffer) > 48 * 1024) throw new Error('Invalid signaling message');
      const message = JSON.parse(data.toString());
      if (state === 'waiting') {
        if (message.type !== 'offer') throw new Error('Send a WebRTC offer first');
        if (admission && !admission.canAuthenticate()) throw new Error('Too many failed attempts. Try again shortly.');
        if (typeof message.token !== 'string' || !tokenMatches(token, message.token)) {
          admission?.recordTokenFailure();
          throw new Error('The gateway access token is missing or incorrect.');
        }
        if (typeof message.peerId !== 'string' || !/^\d{6,16}$/.test(message.peerId) ||
            typeof message.idServer !== 'string' || !message.idServer.trim() || message.idServer.length > 512 ||
            typeof message.key !== 'string' || message.key.length > 256) {
          throw new Error('Invalid ID server or peer ID');
        }
        const offer = decodeEndpoint(message.offer, 'offer');
        sessionKey = sdpFingerprint(offer.sdp);
        peerId = message.peerId;
        state = 'dialing';
        const dial = checkPort(message.idServer, RENDEZVOUS_PORT);
        const connected = await EncryptedFramedStream.connect(dial.host, dial.port, 5_000, { signal: connection.signal });
        if ((state as string) === 'closed') { connected.close(); return; }
        stream = connected;
        if (message.key.trim()) await secureRendezvous(connected, message.key);
        if ((state as string) === 'closed') return;
        await connected.sendRaw(encodeRendezvous({ punch_hole_request: {
          id: peerId, licence_key: message.key.trim(), nat_type: 0,
          conn_type: 0, version: '1.5.3', webrtc_sdp_offer: message.offer,
        } }));
        if ((state as string) === 'closed') return;
        state = 'ready';
        send({ type: 'ready' });
        while (state === 'ready') {
          const raw = await connected.next(15_000);
          if (!raw) throw new Error('ID server closed WebRTC signaling');
          const incoming = decodeRendezvous(raw);
          const ice = incoming.ice_candidate;
          if (ice && ice.session_key === sessionKey && receivedCandidates++ < MAX_CANDIDATES) {
            send({ type: 'candidate', candidate: validateCandidate(ice.candidate) });
          }
          const answer = incoming.punch_hole_response ?? incoming.relay_response;
          if (answer) {
            const refusal = String(incoming.punch_hole_response?.other_failure ?? '').trim()
              || String(incoming.relay_response?.refuse_reason ?? '').trim();
            if (refusal) throw new Error(refusal);
            if (!answer.webrtc_sdp_answer) {
              if (incoming.punch_hole_response && (incoming.punch_hole_response.failure !== undefined ||
                  (!answer.socket_addr?.length && !answer.socket_addr_v6?.length))) {
                throw new Error(punchHoleFailureMessage(incoming.punch_hole_response));
              }
              throw new Error('This peer or ID server did not offer WebRTC');
            }
            decodeEndpoint(answer.webrtc_sdp_answer, 'answer');
            send({ type: 'answer', answer: answer.webrtc_sdp_answer,
              signedPk: Buffer.from(answer.pk ?? []).toString('base64') });
          }
        }
        return;
      }
      if (state !== 'ready' || message.type !== 'candidate' || ++sentCandidates > MAX_CANDIDATES) {
        throw new Error('Unexpected ICE candidate');
      }
      const packet = encodeRendezvous({ ice_candidate: {
        id: peerId, session_key: sessionKey, candidate: validateCandidate(message.candidate),
      } });
      await stream!.sendRaw(packet);
      // The hbbs → controlled-device hop is normally UDP; repeat once like the native client.
      const retry = setTimeout(() => {
        retries.delete(retry);
        if (state === 'ready') void stream!.sendRaw(packet).catch(fail);
      }, 400);
      retries.add(retry);
    })().catch(fail);
  });
  return close;
}
