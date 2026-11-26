import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { serveWebRtcSignal } from './webrtcSignal.ts';
import { BytesFrameDecoder, encodeBytesFrame } from './bytesCodec.ts';
import { decodeRendezvous, encodeRendezvous, PunchFailureValues } from './protos.ts';
import { encodeEndpoint } from '../shared/webrtc.ts';

test('signaling requires a token, excludes passwords and filters ICE by session', async () => {
  const fingerprint = 'sha-256 ' + Array(32).fill('B2').join(':');
  const sdp = `v=0\r\na=fingerprint:${fingerprint}\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n`;
  const sockets = new Set<net.Socket>();
  const requests: Record<string, any>[] = [];
  const hbbs = net.createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    const decoder = new BytesFrameDecoder();
    socket.on('data', chunk => {
      for (const frame of decoder.push(chunk)) {
        const message = decodeRendezvous(frame);
        requests.push(message);
        if (!message.punch_hole_request) continue;
        socket.write(encodeBytesFrame(encodeRendezvous({ punch_hole_response: {
          webrtc_sdp_answer: encodeEndpoint({ type: 'answer', sdp }), pk: Buffer.from('signed-key'),
        } })));
        for (const session_key of ['wrong-session', fingerprint]) {
          socket.write(encodeBytesFrame(encodeRendezvous({ ice_candidate: {
            session_key, candidate: JSON.stringify({ candidate: 'candidate:test', sdpMid: '0' }),
          } })));
        }
      }
    });
  });
  hbbs.listen(0, '127.0.0.1');
  await once(hbbs, 'listening');
  const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  server.on('connection', ws => serveWebRtcSignal(ws, 'gateway-secret'));
  const connect = () => new WebSocket(`ws://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
  const offer = { type: 'offer', peerId: '123456789', key: '',
    idServer: `127.0.0.1:${(hbbs.address() as net.AddressInfo).port}`,
    offer: encodeEndpoint({ type: 'offer', sdp }), password: 'must-not-be-forwarded' };
  try {
    const invalid = connect();
    await once(invalid, 'open');
    const rejected = once(invalid, 'message');
    invalid.send(JSON.stringify({ ...offer, token: 'wrong' }));
    assert.match(JSON.parse(String((await rejected)[0])).message, /token/i);
    assert.equal(requests.length, 0);
    const valid = connect();
    const messages: any[] = [];
    const ready = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Signaling test timed out')), 3000);
      valid.on('message', raw => {
        const message = JSON.parse(raw.toString());
        messages.push(message);
        if (message.type === 'candidate') { clearTimeout(timeout); resolve(); }
      });
    });
    await once(valid, 'open');
    valid.send(JSON.stringify({ ...offer, token: 'gateway-secret' }));
    await ready;
    assert.equal(messages.filter(message => message.type === 'candidate').length, 1);
    assert.equal(messages.find(message => message.type === 'answer').signedPk, Buffer.from('signed-key').toString('base64'));
    assert.ok(requests[0].punch_hole_request.webrtc_sdp_offer);
    assert.ok(!JSON.stringify(requests).includes(offer.password));
    valid.close();
  } finally {
    for (const ws of server.clients) ws.terminate();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await new Promise<void>(resolve => hbbs.close(() => resolve()));
  }
});

const unsupported = 'This peer or ID server did not offer WebRTC';
const failures = [
  { name: 'omitted proto3 ID_NOT_EXIST', reply: { punch_hole_response: {} }, error: 'ID does not exist' },
  { name: 'explicit ID_NOT_EXIST', reply: { punch_hole_response: { failure: PunchFailureValues.ID_NOT_EXIST } }, error: 'ID does not exist' },
  { name: 'offline', reply: { punch_hole_response: { failure: PunchFailureValues.OFFLINE } }, error: 'remote desktop is offline' },
  { name: 'explicit offline even with an address', reply: { punch_hole_response: { failure: PunchFailureValues.OFFLINE, socket_addr: Buffer.of(1) } }, error: 'remote desktop is offline' },
  { name: 'key mismatch', reply: { punch_hole_response: { failure: PunchFailureValues.LICENSE_MISMATCH } }, error: 'key mismatch' },
  { name: 'key overuse', reply: { punch_hole_response: { failure: PunchFailureValues.LICENSE_OVERUSE } }, error: 'key overuse' },
  { name: 'custom failure before enum default', reply: { punch_hole_response: { other_failure: ' Server rejected session ' } }, error: 'Server rejected session' },
  { name: 'unknown failure', reply: { punch_hole_response: { failure: 99 } }, error: 'punch hole failed' },
  { name: 'relay refusal', reply: { relay_response: { refuse_reason: ' Relay policy denied session ' } }, error: 'Relay policy denied session' },
  { name: 'IPv4 peer without WebRTC', reply: { punch_hole_response: { socket_addr: Buffer.of(1) } }, error: unsupported },
  { name: 'IPv6 peer without WebRTC', reply: { punch_hole_response: { socket_addr_v6: Buffer.of(1) } }, error: unsupported },
  { name: 'relay without WebRTC or failure enum', reply: { relay_response: { uuid: 'session', relay_server: 'relay.example.test' } }, error: unsupported },
];

for (const scenario of failures) {
  test(`signaling reports ${scenario.name}`, { timeout: 5_000 }, async t => {
    const previousPrivate = process.env.RUSTDESK_ALLOW_PRIVATE_TARGETS;
    process.env.RUSTDESK_ALLOW_PRIVATE_TARGETS = 'true';
    const sockets = new Set<net.Socket>();
    const hbbs = net.createServer(socket => {
      sockets.add(socket);
      socket.on('error', () => {});
      const decoder = new BytesFrameDecoder();
      socket.on('data', chunk => {
        for (const frame of decoder.push(chunk)) {
          assert.ok(decodeRendezvous(frame).punch_hole_request);
          socket.write(encodeBytesFrame(encodeRendezvous(scenario.reply)));
        }
      });
    });
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    t.after(async () => {
      for (const ws of server.clients) ws.terminate();
      for (const socket of sockets) socket.destroy();
      await Promise.all([
        new Promise<void>(resolve => server.close(() => resolve())),
        new Promise<void>(resolve => hbbs.close(() => resolve())),
      ]);
      if (previousPrivate === undefined) delete process.env.RUSTDESK_ALLOW_PRIVATE_TARGETS;
      else process.env.RUSTDESK_ALLOW_PRIVATE_TARGETS = previousPrivate;
    });
    hbbs.listen(0, '127.0.0.1');
    await Promise.all([once(hbbs, 'listening'), once(server, 'listening')]);
    server.on('connection', ws => serveWebRtcSignal(ws, ''));
    const client = new WebSocket(`ws://127.0.0.1:${(server.address() as net.AddressInfo).port}`);
    const result = new Promise<string>((resolve, reject) => {
      client.on('error', reject);
      client.on('message', raw => {
        const message = JSON.parse(raw.toString());
        if (message.type === 'error') resolve(message.message);
        if (message.type === 'answer') reject(new Error('Unexpected successful WebRTC answer'));
      });
    });
    await once(client, 'open');
    client.send(JSON.stringify({
      type: 'offer', peerId: '123456789', key: '', token: '',
      idServer: `127.0.0.1:${(hbbs.address() as net.AddressInfo).port}`,
      offer: encodeEndpoint({ type: 'offer', sdp: `v=0\r\na=fingerprint:sha-256 ${Array(32).fill('A1').join(':')}\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\n` }),
    }));
    assert.equal(await result, scenario.error);
  });
}
