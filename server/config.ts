import { isIP } from 'node:net';
import { createClientAddressResolver, createRequestProtocolResolver } from './clientAddress.ts';
import { parseBrowserOrigin, productionTokenProblem } from './security.ts';

export interface RuntimeConfig {
  readonly production: boolean;
  readonly host: string;
  readonly port: number;
  readonly gatewayToken: string;
  readonly webRtcEnabled: boolean;
  readonly requireOrigin: boolean;
  readonly allowedOrigins: string;
  readonly allowPrivateTargets: boolean;
  readonly allowedTargetPorts: readonly number[];
  readonly defaultForceRelay: boolean;
  readonly clientAddress: ReturnType<typeof createClientAddressResolver>;
  readonly requestProtocol: ReturnType<typeof createRequestProtocolResolver>;
}

function booleanSetting(env: NodeJS.ProcessEnv, name: string, fallback = false): boolean {
  const value = env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false.`);
}

function portSetting(value: string, name: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must contain only port numbers from 1 to 65535.`);
  }
  return port;
}

function allowedOrigins(env: NodeJS.ProcessEnv, render: boolean): string {
  const origins = (env.RUSTDESK_ALLOWED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  if (origins.length) {
    return [...new Set(origins.map(value => {
      if (value === '*') return value;
      const origin = parseBrowserOrigin(value);
      if (!origin) throw new Error('RUSTDESK_ALLOWED_ORIGINS must contain only HTTP(S) origins or *.');
      return origin.origin;
    }))].join(',');
  }
  // Render supplies this deployment URL, independently of untrusted request headers.
  // https://render.com/docs/environment-variables#render_external_url
  const renderUrl = render ? env.RENDER_EXTERNAL_URL?.trim() : '';
  if (!renderUrl) return '';
  const origin = parseBrowserOrigin(renderUrl);
  if (!origin || origin.protocol !== 'https:' || origin.port || !origin.hostname.endsWith('.onrender.com')) {
    throw new Error('RENDER_EXTERNAL_URL must be the HTTPS onrender.com origin of this service.');
  }
  return origin.origin;
}

/** Parse once before listening. Errors name settings, never their potentially secret values. */
export function parseRuntimeConfig(env: NodeJS.ProcessEnv): RuntimeConfig {
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase() || 'development';
  if (!['development', 'production', 'test'].includes(nodeEnv)) {
    throw new Error('NODE_ENV must be development, production or test.');
  }
  const production = nodeEnv === 'production';
  const render = booleanSetting(env, 'RENDER');
  const configuredHost = env.HOST?.trim() || '127.0.0.1';
  if (!isIP(configuredHost) && !/^(?=.{1,253}$)[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(configuredHost)) {
    throw new Error('HOST must be an IP address or hostname without a port.');
  }
  const rawToken = (env.RUSTDESK_GATEWAY_TOKEN ?? '').trim().replace(/^["']|["']$/g, '').trim();
  const gatewayToken = /^(MY_GATEWAY_TOKEN|YOUR_GATEWAY_TOKEN|CHANGE_ME|PLACEHOLDER)$/i.test(rawToken) ? '' : rawToken;
  const tokenProblem = productionTokenProblem(nodeEnv, gatewayToken);
  if (tokenProblem) throw new Error(tokenProblem);
  const ports = (env.RUSTDESK_ALLOWED_TARGET_PORTS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  return Object.freeze({
    production,
    host: render ? '0.0.0.0' : configuredHost,
    port: portSetting(env.PORT?.trim() || '3000', 'PORT'),
    gatewayToken,
    webRtcEnabled: booleanSetting(env, 'RUSTDESK_ENABLE_WEBRTC'),
    requireOrigin: booleanSetting(env, 'RUSTDESK_REQUIRE_ORIGIN'),
    allowedOrigins: allowedOrigins(env, render),
    allowPrivateTargets: booleanSetting(env, 'RUSTDESK_ALLOW_PRIVATE_TARGETS', !production),
    allowedTargetPorts: Object.freeze([...new Set(ports.map(value => portSetting(value, 'RUSTDESK_ALLOWED_TARGET_PORTS')))]),
    defaultForceRelay: booleanSetting(env, 'RUSTDESK_DEFAULT_FORCE_RELAY'),
    clientAddress: createClientAddressResolver(env),
    requestProtocol: createRequestProtocolResolver(env),
  });
}

let runtimeConfig: RuntimeConfig | undefined;

export function getRuntimeConfig(): RuntimeConfig {
  return runtimeConfig ??= parseRuntimeConfig(process.env);
}

/** Inject an already parsed snapshot; restore it after isolated protocol tests. */
export function setRuntimeConfig(config: RuntimeConfig): () => void {
  const previous = runtimeConfig;
  runtimeConfig = config;
  return () => { runtimeConfig = previous; };
}
