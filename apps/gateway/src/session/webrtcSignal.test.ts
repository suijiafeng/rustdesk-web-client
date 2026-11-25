// Copyright (C) 2026 suijiafeng. Licensed under AGPL-3.0-only.

import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { once } from 'node:events';
import { WebSocket, WebSocketServer } from 'ws';
import { serveWebRtcSignal } from './webrtcSignal.ts';
import { BytesFrameDecoder, encodeBytesFrame, decodeRendezvous, encodeRendezvous, encodeEndpoint } from '@rustdesk-web/protocol';

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
      assert.ok(Buffer.isBuffer(chunk));
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
