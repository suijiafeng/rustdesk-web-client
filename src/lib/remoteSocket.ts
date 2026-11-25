import type { ClientMessage } from '../../server/control';
import type { createNativeSession } from './webrtc/session';

export class RemoteSocket {
  binaryType: BinaryType = 'arraybuffer';
  readyState: number = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  private gateway: WebSocket;
  private mode: 'gateway' | 'trying' | 'webrtc' | 'closed' = 'gateway';
  private abort: AbortController | null = null;
  private session: ReturnType<typeof createNativeSession> | null = null;

  constructor(private url: string) { this.gateway = this.openGateway(); }

  private openGateway(connect?: string): WebSocket {
    const socket = new WebSocket(this.url);
    socket.binaryType = 'arraybuffer';
    socket.onopen = event => {
      if (this.mode === 'closed' || socket !== this.gateway) { socket.close(); return; }
      this.readyState = WebSocket.OPEN;
      if (connect) socket.send(connect);
      else this.onopen?.(event);
    };
    socket.onmessage = event => { if (this.mode === 'gateway' && socket === this.gateway) this.onmessage?.(event); };
    socket.onerror = event => { if (this.mode === 'gateway' && socket === this.gateway) this.onerror?.(event); };
    socket.onclose = event => {
      if (this.mode !== 'gateway' || socket !== this.gateway) return;
      this.readyState = WebSocket.CLOSED;
      this.onclose?.(event);
    };
    return socket;
  }

  send(data: string): void {
    if (this.mode === 'closed') return;
    const message = JSON.parse(data) as ClientMessage;
    if (this.mode === 'webrtc') { this.session?.send(message); return; }
    if (message.type === 'connect' && message.mode === 'id' && !message.forceRelay &&
        typeof RTCPeerConnection !== 'undefined' && globalThis.isSecureContext) {
      if (this.mode === 'trying') return;
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
        this.gateway.close();
        this.session = createNativeSession(conn, selectCodecs(message.codecs),
          value => this.onmessage?.(new MessageEvent('message', { data: value })), () => this.close());
        this.session.start();
      })().catch(async error => {
        if (abort.signal.aborted || this.mode === 'closed') return;
        if (error?.name === 'WebRtcLoginError') {
          this.onmessage?.(new MessageEvent('message', { data: JSON.stringify({
            type: 'status', state: 'error', detail: error.message,
          }) }));
          this.close();
          return;
        }
        this.mode = 'gateway';
        if (this.gateway.readyState === WebSocket.OPEN) this.gateway.send(data);
        else this.gateway = this.openGateway(data);
      });
      return;
    }
    if (this.mode === 'gateway') this.gateway.send(data);
  }

  close(): void {
    if (this.mode === 'closed') return;
    this.mode = 'closed';
    this.readyState = WebSocket.CLOSED;
    this.abort?.abort();
    this.session?.close();
    this.gateway.close();
    this.onclose?.(new CloseEvent('close', { code: 1000, wasClean: true }));
  }
}
