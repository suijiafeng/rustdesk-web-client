export type ConnectionMode = 'id' | 'direct';
export type ConnectionPhase = 'idle' | 'connecting' | 'live' | 'error';

export interface ConnectRequest {
  mode?: ConnectionMode;
  peerId?: string;
  idServer?: string;
  relayServer?: string;
  serverKey?: string;
  forceRelay?: boolean;
  host?: string;
  port?: string;
  password?: string;
  gatewayToken?: string;
  remember?: boolean;
}

export type ConnectionField =
  | 'host'
  | 'port'
  | 'password'
  | 'peerId'
  | 'idServer'
  | 'relayServer'
  | 'serverKey';

