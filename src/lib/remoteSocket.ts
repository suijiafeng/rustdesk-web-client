import type { ClientMessage } from '../../server/control';
import type { createNativeSession } from './webrtc/session';

export class RemoteSocket {
  binaryType: BinaryType = 'arraybuffer';
  readyState: number = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  private gateway: WebSocket | null = null;
  private mode: 'pending' | 'gateway' | 'trying' | 'webrtc' | 'closed' = 'pending';
  private abort: AbortController | null = null;
  private session: ReturnType<typeof createNativeSession> | null = null;

  constructor(private url: string) {
    // Let the caller provide the connection request without opening a gateway socket.
    queueMicrotask(() => {
      if (this.mode !== 'pending') return;
      this.readyState = WebSocket.OPEN;
      this.onopen?.(new Event('open'));
    });
  }

  private openGateway(connect: string): void {
    this.mode = 'gateway';
    this.readyState = WebSocket.CONNECTING;
    const socket = new WebSocket(this.url);
    this.gateway = socket;
    socket.binaryType = this.binaryType;
    socket.onopen = () => {
      if (this.mode !== 'gateway' || socket !== this.gateway) return;
      this.readyState = WebSocket.OPEN;
      socket.send(connect);
    };
    socket.onmessage = event => { if (this.mode === 'gateway' && socket === this.gateway) this.onmessage?.(event); };
    socket.onerror = event => { if (this.mode === 'gateway' && socket === this.gateway) this.onerror?.(event); };
    socket.onclose = event => {
      if (this.mode !== 'gateway' || socket !== this.gateway) return;
      this.readyState = WebSocket.CLOSED;
      this.onclose?.(event);
    };
  }

  send(data: string): void {
    if (this.mode === 'gateway') {
      if (this.gateway?.readyState === WebSocket.OPEN) this.gateway.send(data);
      return;
    }
    if (this.mode === 'closed' || this.mode === 'trying') return;
    const message = JSON.parse(data) as ClientMessage;
    if (this.mode === 'webrtc') { this.session?.send(message); return; }
    if (message.type !== 'connect') return;
    if (message.mode === 'id' && !message.forceRelay && /^\d{6,16}$/.test(message.peerId ?? '') &&
        typeof RTCPeerConnection !== 'undefined' && globalThis.isSecureContext) {
      this.mode = 'trying';
      this.abort = new AbortController();
      const abort = this.abort;
      void (async () => {
        const [{ connectWebRtc }, { createNativeSession }, { selectCodecs }] = await Promise.all([
          import('./webrtc/connect'), import('./webrtc/session'), import('../../server/control'),
        ]);
        if (abort.signal.aborted) return;
        const conn = await connectWebRtc(this.url, message, abort.signal);
        if (abort.signal.aborted) { conn.stream.close(); return; }
        this.mode = 'webrtc';
        this.session = createNativeSession(conn, selectCodecs(message.codecs),
          value => this.onmessage?.(new MessageEvent('message', { data: value })), () => this.close(), message.codec);
        this.session.start();
      })().catch(async error => {
        if (abort.signal.aborted || this.mode === 'closed') return;
        if (error?.name === 'WebRtcLoginError' || this.mode === 'webrtc') {
          this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({
            type: 'status', state: 'error', detail: error.message,
          }) }));
          this.close();
          return;
        }
        this.openGateway(data);
      });
      return;
    }
    this.openGateway(data);
  }

  close(): void {
    if (this.mode === 'closed') return;
    this.mode = 'closed';
    this.readyState = WebSocket.CLOSED;
    this.abort?.abort();
    this.session?.close();
    this.gateway?.close();
    this.onclose?.(new CloseEvent('close', { code: 1000, wasClean: true }));
  }
}
