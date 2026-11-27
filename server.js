// server.ts
import "dotenv/config";
import express2 from "express";
import http from "node:http";
import path2 from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

// server/admission.ts
var WINDOW_MS = 6e4;
var MAX_TRACKED_ADDRESSES = 4096;
var MAX_UPGRADES_PER_WINDOW = 24;
var MAX_SESSIONS_PER_IP = 4;
var MAX_SESSIONS = 128;
var GatewayAdmissionLimiter = class {
  constructor(now = () => performance.now()) {
    this.now = now;
    this.clients = /* @__PURE__ */ new Map();
    this.active = 0;
    this.sweepAt = 0;
  }
  acquire(address) {
    if (this.active >= MAX_SESSIONS) return null;
    const now = this.now();
    if (now >= this.sweepAt) {
      this.sweepAt = now + WINDOW_MS;
      for (const [ip, usage2] of this.clients) {
        if (!usage2.active && now >= Math.max(usage2.windowEnd, usage2.failureReset)) this.clients.delete(ip);
      }
    }
    let usage = this.clients.get(address);
    if (!usage) {
      if (this.clients.size >= MAX_TRACKED_ADDRESSES) return null;
      usage = { active: 0, upgrades: 0, windowEnd: 0, failures: 0, failureReset: 0, blockedUntil: 0 };
      this.clients.set(address, usage);
    }
    if (now >= usage.windowEnd) {
      usage.upgrades = 0;
      usage.windowEnd = now + WINDOW_MS;
    }
    if (usage.active >= MAX_SESSIONS_PER_IP || usage.upgrades >= MAX_UPGRADES_PER_WINDOW || now < usage.blockedUntil) {
      return null;
    }
    usage.active++;
    usage.upgrades++;
    this.active++;
    let released = false;
    return {
      canAuthenticate: () => this.now() >= usage.blockedUntil,
      recordTokenFailure: () => {
        const now2 = this.now();
        if (now2 >= usage.failureReset) usage.failures = 0;
        usage.failures = Math.min(8, usage.failures + 1);
        usage.failureReset = now2 + WINDOW_MS;
        if (usage.failures >= 3) {
          usage.blockedUntil = now2 + Math.min(3e4, 1e3 * 2 ** (usage.failures - 3));
        }
      },
      release: () => {
        if (released) return;
        released = true;
        usage.active--;
        this.active--;
      }
    };
  }
};

// server/config.ts
import { isIP as isIP3 } from "node:net";

// server/clientAddress.ts
import { BlockList, isIP } from "node:net";
function normalizeAddress(raw) {
  const address = raw.trim();
  const version = isIP(address);
  if (!version || address.includes("%")) return null;
  if (version === 4) return address;
  const canonical = new URL(`http://[${address}]/`).hostname.slice(1, -1);
  const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(canonical);
  if (!mapped) return canonical;
  const high = Number.parseInt(mapped[1], 16);
  const low = Number.parseInt(mapped[2], 16);
  return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
}
function createTrustedProxyChecker(env) {
  const trusted = new BlockList();
  for (const item of (env.RUSTDESK_TRUSTED_PROXIES ?? "").split(",")) {
    const entry = item.trim();
    if (!entry) continue;
    const parts = entry.split("/");
    const address = normalizeAddress(parts[0]);
    let prefix = parts.length === 2 && /^\d+$/.test(parts[1]) ? Number(parts[1]) : NaN;
    const originalVersion = isIP(parts[0].trim());
    if (!address || parts.length > 2 || parts.length === 2 && (!Number.isInteger(prefix) || prefix < 0 || prefix > (originalVersion === 4 ? 32 : 128))) {
      throw new Error("RUSTDESK_TRUSTED_PROXIES must contain only valid IP addresses or CIDR ranges.");
    }
    const family = isIP(address) === 4 ? "ipv4" : "ipv6";
    if (parts.length === 1) {
      trusted.addAddress(address, family);
    } else {
      if (originalVersion === 6 && family === "ipv4") {
        if (prefix < 96) throw new Error("IPv4-mapped RUSTDESK_TRUSTED_PROXIES ranges require a prefix of at least 96.");
        prefix -= 96;
      }
      trusted.addSubnet(address, prefix, family);
    }
  }
  return (raw) => {
    const address = normalizeAddress(raw ?? "");
    return address !== null && trusted.check(address, isIP(address) === 4 ? "ipv4" : "ipv6");
  };
}
function createRequestProtocolResolver(env) {
  const isTrusted = createTrustedProxyChecker(env);
  return (remoteAddress, headers, encrypted = false) => {
    const forwarded = headers["x-forwarded-proto"];
    if (isTrusted(remoteAddress) && forwarded !== void 0) {
      if (typeof forwarded !== "string") return null;
      const protocol = forwarded.trim().toLowerCase();
      return protocol === "http" || protocol === "https" ? `${protocol}:` : null;
    }
    return encrypted ? "https:" : "http:";
  };
}
function createClientAddressResolver(env) {
  const isTrusted = createTrustedProxyChecker(env);
  const header = env.RUSTDESK_CLIENT_IP_HEADER?.trim().toLowerCase() || "x-forwarded-for";
  if (header !== "x-forwarded-for" && header !== "cf-connecting-ip") {
    throw new Error("RUSTDESK_CLIENT_IP_HEADER must be x-forwarded-for or cf-connecting-ip.");
  }
  return (remoteAddress, headers) => {
    const peer = normalizeAddress(remoteAddress ?? "");
    if (!peer) return remoteAddress || "unknown";
    if (!isTrusted(peer)) return peer;
    const forwarded = headers[header];
    if (typeof forwarded !== "string") return peer;
    if (header === "cf-connecting-ip") return normalizeAddress(forwarded) ?? peer;
    const hops = forwarded.split(",");
    for (let index = hops.length - 1; index >= 0; index--) {
      const address = normalizeAddress(hops[index]);
      if (!address) return peer;
      if (!isTrusted(address)) return address;
    }
    return peer;
  };
}

// server/security.ts
import { BlockList as BlockList2, isIP as isIP2 } from "node:net";
var LOOPBACK = /* @__PURE__ */ new Set(["localhost", "127.0.0.1", "::1"]);
function parseBrowserOrigin(value) {
  if (!/^https?:\/\//i.test(value) || /[\s\\@?#]/.test(value)) return null;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.pathname === "/" ? url : null;
  } catch {
    return null;
  }
}
function originAllowed(origin, requestHost, allowlist, required = false, { protocol, allowLoopback = false } = { protocol: "http:" }) {
  if (!origin) return !required;
  const source = parseBrowserOrigin(origin);
  if (!source) return false;
  const list = allowlist.split(",").map((item) => item.trim()).filter(Boolean);
  if (list.includes("*")) return true;
  if (list.length > 0) return list.some((entry) => parseBrowserOrigin(entry)?.origin === source.origin);
  if (!protocol || !requestHost || /[\s\\/@?#]/.test(requestHost)) return false;
  const destination = parseBrowserOrigin(`${protocol}//${requestHost}`);
  if (!destination) return false;
  if (source.origin === destination.origin) return true;
  return allowLoopback && source.protocol === destination.protocol && LOOPBACK.has(source.hostname.replace(/^\[|\]$/g, "")) && LOOPBACK.has(destination.hostname.replace(/^\[|\]$/g, ""));
}
function productionTokenProblem(nodeEnv, token) {
  if (nodeEnv === "production" && token.trim().length === 0) {
    return "Set RUSTDESK_GATEWAY_TOKEN before starting the gateway in production.";
  }
  return null;
}
var SECRET_LOG = /((?:token|password|authorization|secret|serverkey)\s*[:=]\s*)(\S+)/gi;
function redactLog(message) {
  return message.replace(SECRET_LOG, "$1[redacted]");
}
function targetHostAllowed(host) {
  const text = host.trim().toLowerCase().replace(/\.$/, "");
  return Boolean(text) && !/[\s\\/@%\[\]?#]/.test(text) && text !== "metadata.google.internal";
}
var blocked = new BlockList2();
blocked.addSubnet("0.0.0.0", 8);
blocked.addSubnet("169.254.0.0", 16);
blocked.addSubnet("224.0.0.0", 3);
blocked.addAddress("100.100.100.200");
blocked.addAddress("168.63.129.16");
blocked.addAddress("fd00:ec2::254", "ipv6");
blocked.addSubnet("fe80::", 10, "ipv6");
var privateV4 = new BlockList2();
privateV4.addSubnet("10.0.0.0", 8);
privateV4.addSubnet("100.64.0.0", 10);
privateV4.addSubnet("127.0.0.0", 8);
privateV4.addSubnet("172.16.0.0", 12);
privateV4.addSubnet("192.168.0.0", 16);
privateV4.addSubnet("198.18.0.0", 15);
var mappedV4 = new BlockList2();
mappedV4.addSubnet("::ffff:0:0", 96, "ipv6");
var globalV6 = new BlockList2();
globalV6.addSubnet("2000::", 3, "ipv6");
var specialV6 = new BlockList2();
specialV6.addSubnet("2001::", 32, "ipv6");
specialV6.addSubnet("2002::", 16, "ipv6");
var privateV6 = new BlockList2();
privateV6.addAddress("::1", "ipv6");
privateV6.addSubnet("fc00::", 7, "ipv6");
function targetAddressAllowed(address, allowPrivate) {
  const version = isIP2(address);
  if (!version || address.includes("%")) return false;
  const family = version === 4 ? "ipv4" : "ipv6";
  if (blocked.check(address, family)) return false;
  if (version === 4 || mappedV4.check(address, "ipv6")) {
    return allowPrivate || !privateV4.check(address, family);
  }
  return globalV6.check(address, "ipv6") && !specialV6.check(address, "ipv6") || allowPrivate && privateV6.check(address, "ipv6");
}
function targetPortAllowed(port, peerConnection, config) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return false;
  return peerConnection || !config.production || port >= 21114 && port <= 21119 || config.allowedTargetPorts.includes(port);
}

// server/config.ts
function booleanSetting(env, name, fallback = false) {
  const value = env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new Error(`${name} must be true or false.`);
}
function portSetting(value, name) {
  const port = Number(value);
  if (!/^\d+$/.test(value) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name} must contain only port numbers from 1 to 65535.`);
  }
  return port;
}
function allowedOrigins(env, render) {
  const origins = (env.RUSTDESK_ALLOWED_ORIGINS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  if (origins.length) {
    return [...new Set(origins.map((value) => {
      if (value === "*") return value;
      const origin2 = parseBrowserOrigin(value);
      if (!origin2) throw new Error("RUSTDESK_ALLOWED_ORIGINS must contain only HTTP(S) origins or *.");
      return origin2.origin;
    }))].join(",");
  }
  const renderUrl = render ? env.RENDER_EXTERNAL_URL?.trim() : "";
  if (!renderUrl) return "";
  const origin = parseBrowserOrigin(renderUrl);
  if (!origin || origin.protocol !== "https:" || origin.port || !origin.hostname.endsWith(".onrender.com")) {
    throw new Error("RENDER_EXTERNAL_URL must be the HTTPS onrender.com origin of this service.");
  }
  return origin.origin;
}
function parseRuntimeConfig(env) {
  const nodeEnv = env.NODE_ENV?.trim().toLowerCase() || "development";
  if (!["development", "production", "test"].includes(nodeEnv)) {
    throw new Error("NODE_ENV must be development, production or test.");
  }
  const production = nodeEnv === "production";
  const render = booleanSetting(env, "RENDER");
  const configuredHost = env.HOST?.trim() || "127.0.0.1";
  if (!isIP3(configuredHost) && !/^(?=.{1,253}$)[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(configuredHost)) {
    throw new Error("HOST must be an IP address or hostname without a port.");
  }
  const rawToken = (env.RUSTDESK_GATEWAY_TOKEN ?? "").trim().replace(/^["']|["']$/g, "").trim();
  const gatewayToken = /^(MY_GATEWAY_TOKEN|YOUR_GATEWAY_TOKEN|CHANGE_ME|PLACEHOLDER)$/i.test(rawToken) ? "" : rawToken;
  const tokenProblem = productionTokenProblem(nodeEnv, gatewayToken);
  if (tokenProblem) throw new Error(tokenProblem);
  const ports = (env.RUSTDESK_ALLOWED_TARGET_PORTS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
  return Object.freeze({
    production,
    host: render ? "0.0.0.0" : configuredHost,
    port: portSetting(env.PORT?.trim() || "3000", "PORT"),
    gatewayToken,
    webRtcEnabled: booleanSetting(env, "RUSTDESK_ENABLE_WEBRTC"),
    requireOrigin: booleanSetting(env, "RUSTDESK_REQUIRE_ORIGIN"),
    allowedOrigins: allowedOrigins(env, render),
    allowPrivateTargets: booleanSetting(env, "RUSTDESK_ALLOW_PRIVATE_TARGETS", !production),
    allowedTargetPorts: Object.freeze([...new Set(ports.map((value) => portSetting(value, "RUSTDESK_ALLOWED_TARGET_PORTS")))]),
    defaultForceRelay: booleanSetting(env, "RUSTDESK_DEFAULT_FORCE_RELAY"),
    clientAddress: createClientAddressResolver(env),
    requestProtocol: createRequestProtocolResolver(env)
  });
}
var runtimeConfig;
function getRuntimeConfig() {
  return runtimeConfig ??= parseRuntimeConfig(process.env);
}

// server/httpHosting.ts
import express from "express";
import path from "node:path";
function installApiNotFound(app) {
  app.use("/api", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(404).json({ error: "API endpoint not found" });
  });
}
function serveProductionFiles(app, distDir) {
  app.use(express.static(distDir, {
    setHeaders: (res, filename) => {
      const relative = path.relative(distDir, filename);
      const versionedAsset = relative.startsWith(`assets${path.sep}`) && /-[A-Za-z0-9_-]{8,}\.[^.]+$/.test(path.basename(filename));
      res.setHeader("Cache-Control", versionedAsset ? "public, max-age=31536000, immutable" : "no-cache");
    }
  }));
  app.use("/assets", (_req, res) => res.sendStatus(404));
  app.get("*", (_req, res, next) => {
    res.sendFile(path.join(distDir, "index.html"), { headers: { "Cache-Control": "no-cache" } }, (error) => {
      if (error) next(error);
    });
  });
}
function createGatewayShutdown(httpServer, wss, options) {
  const sockets = /* @__PURE__ */ new Set();
  const sessions = /* @__PURE__ */ new Map();
  let stopping = false;
  let shutdown;
  httpServer.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    if (stopping) socket.destroy();
  });
  const closeSession = (ws, cleanup) => {
    try {
      if (ws.readyState === ws.OPEN) ws.close(1001, "Gateway shutting down");
    } catch (error) {
      options.onError(error);
      ws.terminate();
    } finally {
      try {
        cleanup();
      } catch (error) {
        options.onError(error);
      }
    }
  };
  return {
    get stopping() {
      return stopping;
    },
    track(ws, cleanup) {
      if (stopping) {
        closeSession(ws, cleanup);
        return;
      }
      sessions.set(ws, cleanup);
      ws.once("close", () => sessions.delete(ws));
    },
    close() {
      if (shutdown) return shutdown;
      stopping = true;
      shutdown = new Promise((resolve) => {
        const deadline = setTimeout(() => {
          for (const ws of wss.clients) ws.terminate();
          for (const socket of sockets) socket.destroy();
          resolve();
        }, options.timeoutMs ?? 3e3);
        const httpClosed = new Promise((done) => httpServer.close((error) => {
          if (error && error.code !== "ERR_SERVER_NOT_RUNNING") options.onError(error);
          done();
        }));
        const wsClosed = new Promise((done) => wss.close(() => done()));
        for (const [ws, cleanup] of sessions) closeSession(ws, cleanup);
        sessions.clear();
        for (const ws of wss.clients) {
          if (ws.readyState === ws.OPEN) closeSession(ws, () => {
          });
        }
        const frontendClosed = Promise.resolve().then(() => options.closeFrontend?.()).catch(options.onError);
        void Promise.all([httpClosed, wsClosed, frontendClosed]).then(() => {
          clearTimeout(deadline);
          resolve();
        });
      });
      return shutdown;
    }
  };
}

// shared/errors.ts
var ERROR_CODES = [
  "GATEWAY_TOKEN_INVALID",
  "RATE_LIMITED",
  "PASSWORD_INVALID",
  "PASSWORD_REQUIRED",
  "TWO_FACTOR_REQUIRED",
  "PEER_NOT_FOUND",
  "PEER_OFFLINE",
  "IDENTITY_INVALID",
  "TARGET_ADDRESS_BLOCKED",
  "TARGET_PORT_BLOCKED",
  "DNS_FAILED",
  "UNREACHABLE",
  "TIMEOUT",
  "CONNECTION_CLOSED",
  "SESSION_INTERRUPTED",
  "PROTOCOL_INVALID",
  "PROTOCOL_HTTP",
  "WEBRTC_UNAVAILABLE",
  "WEBRTC_FAILED",
  "WEBRTC_CSP",
  "CODEC_UNSUPPORTED",
  "CODEC_FAILED",
  "INSECURE_CONTEXT",
  "GATEWAY_UNAVAILABLE",
  "INVALID_REQUEST",
  "UNKNOWN"
];
var ERROR_STAGES = ["admission", "rendezvous", "identity", "login", "signaling", "transport", "session", "codec", "input"];
var AppError = class extends Error {
  constructor(code, stage, raw) {
    super(raw);
    this.code = code;
    this.stage = stage;
    this.name = "AppError";
    this.detail = raw;
  }
};
function readErrorPayload(value) {
  if (!value || typeof value !== "object") return;
  const payload = value;
  if (!ERROR_CODES.includes(payload.code) || !ERROR_STAGES.includes(payload.stage) || typeof payload.detail !== "string") return;
  return { code: payload.code, stage: payload.stage, detail: payload.detail.slice(0, 4096) };
}
function classifyLegacyError(raw) {
  const text = raw.toLowerCase();
  if (/too many failed attempts/.test(text)) return "RATE_LIMITED";
  if (/two.factor authentication|2fa required|wrong 2fa code/.test(text)) return "TWO_FACTOR_REQUIRED";
  if (/gateway(?: access)? token|invalid token|token (?:required|missing|incorrect)|令牌/.test(text)) return "GATEWAY_TOKEN_INVALID";
  if (/wrong password|rejected the password/.test(text)) return "PASSWORD_INVALID";
  if (/empty password|requires a password|no password access/.test(text)) return "PASSWORD_REQUIRED";
  if (/target address is not allowed/.test(text)) return "TARGET_ADDRESS_BLOCKED";
  if (/target port is not allowed/.test(text)) return "TARGET_PORT_BLOCKED";
  if (/secure context|webcodecs.*https/.test(text)) return "INSECURE_CONTEXT";
  if (/cannot decode|不支持 vp8/.test(text)) return "CODEC_UNSUPPORTED";
  if (/webcodecs|videodecoder/.test(text)) return "CODEC_FAILED";
  if (/session disconnected unexpectedly|远程会话意外断开/.test(text)) return "SESSION_INTERRUPTED";
  if (/dns lookup|enotfound|eai_again|eai_nodata|eai_noname|eservfail|域名解析/.test(text)) return "DNS_FAILED";
  if (/signature|public key|server key|key mismatch|key overuse|signed_params|identity|decrypt|certificate|fingerprint/.test(text)) return "IDENTITY_INVALID";
  if (/unsafe-eval/.test(text)) return "WEBRTC_CSP";
  if (/timed out|timeout|etimedout|did not answer in time/.test(text)) return "TIMEOUT";
  if (/id does not exist|peer not found/.test(text)) return "PEER_NOT_FOUND";
  if (/offline|not match this host/.test(text)) return "PEER_OFFLINE";
  if (/not a rustdesk|http response|http\/https|tls\/https|ssh service|invalid wire type|index out of range|frame overflow|invalid protocol/.test(text)) {
    return /http|tls/.test(text) ? "PROTOCOL_HTTP" : "PROTOCOL_INVALID";
  }
  if (/did not offer webrtc|webrtc signaling unavailable/.test(text)) return "WEBRTC_UNAVAILABLE";
  if (/host closed|peer closed|signaling closed|closed.*signaling|channel is closed|closed connection/.test(text)) return "CONNECTION_CLOSED";
  if (/cannot reach|connection refused|econnrefused|failed to connect|os error 111|network is unreachable|enetunreach|ehostunreach/.test(text)) return "UNREACHABLE";
  if (/invalid id server or peer id|invalid signaling|send a webrtc offer|unexpected ice/.test(text)) return "INVALID_REQUEST";
  if (/webrtc.*failed|invalid webrtc endpoint|invalid webrtc session description|invalid ice candidate|incompatible id server/.test(text)) return "WEBRTC_FAILED";
  if (/gateway|网关/.test(text)) return "GATEWAY_UNAVAILABLE";
  return "UNKNOWN";
}
function asAppError(error, stage = "session") {
  const payload = readErrorPayload(error);
  if (payload) return new AppError(payload.code, payload.stage, payload.detail);
  const raw = error instanceof Error ? error.message : String(error ?? "");
  return new AppError(classifyLegacyError(raw), stage, raw);
}
function errorPayload(error, stage = "session") {
  const value = asAppError(error, stage);
  return { code: value.code, stage: value.stage, detail: value.detail.slice(0, 4096) };
}

// server/auth.ts
import crypto from "node:crypto";
import net from "node:net";
var RENDEZVOUS_PORT = 21116;
var RELAY_PORT = 21117;
var DEFAULT_DIRECT_PORT = RENDEZVOUS_PORT + 2;
function passwordResponse(password, salt, challenge) {
  const h1 = crypto.createHash("sha256").update(Buffer.from(password, "utf8")).update(Buffer.from(salt, "utf8")).digest();
  return crypto.createHash("sha256").update(h1).update(Buffer.from(challenge, "utf8")).digest();
}
function sanitizeHostInput(raw) {
  let s = (raw ?? "").replace(/[\u200B-\u200D\uFEFF]/g, "").trim().replace(/：/g, ":");
  s = s.replace(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//, "");
  const cutIdx = s.search(/[/?#]/);
  if (cutIdx !== -1) {
    s = s.slice(0, cutIdx);
  }
  return s.trim();
}
function hostHasPort(host) {
  const trimmed = sanitizeHostInput(host);
  if (trimmed.startsWith("[")) {
    return trimmed.includes("]:");
  }
  const first = trimmed.indexOf(":");
  return first !== -1 && first === trimmed.lastIndexOf(":");
}
function isIpStr(host) {
  const trimmed = sanitizeHostInput(host);
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end === -1) return false;
    return net.isIP(trimmed.slice(1, end)) !== 0;
  }
  if (hostHasPort(trimmed)) {
    const idx = trimmed.lastIndexOf(":");
    return net.isIP(trimmed.slice(0, idx)) !== 0;
  }
  return net.isIP(trimmed) !== 0;
}
function checkPort(host, defaultPort) {
  const trimmed = sanitizeHostInput(host);
  if (trimmed.startsWith("[")) {
    const end = trimmed.indexOf("]");
    if (end !== -1) {
      const addr = trimmed.slice(1, end);
      const rest = trimmed.slice(end + 1);
      if (rest.startsWith(":")) {
        const parsed2 = Number.parseInt(rest.slice(1), 10);
        if (Number.isFinite(parsed2) && parsed2 > 0 && parsed2 <= 65535) {
          return { host: addr, port: parsed2 };
        }
      }
      return { host: addr, port: defaultPort };
    }
  }
  if (net.isIP(trimmed) === 6) {
    return { host: trimmed, port: defaultPort };
  }
  const idx = trimmed.lastIndexOf(":");
  if (idx !== -1 && trimmed.indexOf(":") === idx) {
    const hostPart = trimmed.slice(0, idx).trim();
    const portPart = trimmed.slice(idx + 1).trim();
    const parsed2 = Number.parseInt(portPart, 10);
    if (hostPart && /^\d+$/.test(portPart) && parsed2 > 0 && parsed2 <= 65535) {
      return { host: hostPart, port: parsed2 };
    }
  }
  return { host: trimmed, port: defaultPort };
}
function formatHostPort(host, port) {
  if (net.isIP(host) === 6) {
    return `[${host}]:${port}`;
  }
  return `${host}:${port}`;
}
function directUsername(host, port, remoteAddress) {
  const trimmed = sanitizeHostInput(host);
  if (isIpStr(trimmed) && hostHasPort(trimmed)) {
    return trimmed;
  }
  const parsed2 = checkPort(trimmed, port);
  return formatHostPort(net.isIP(parsed2.host) ? parsed2.host : remoteAddress ?? parsed2.host, parsed2.port);
}
function tokenMatches(expected, given) {
  const cleanExpected = (expected ?? "").trim();
  if (!cleanExpected) return true;
  const a = Buffer.from(cleanExpected, "utf8");
  const b = Buffer.from((given ?? "").trim(), "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function authenticateGateway(expected, given, admission) {
  if (admission && !admission.canAuthenticate()) {
    throw new AppError("RATE_LIMITED", "admission", "Too many failed attempts. Try again shortly.");
  }
  if (!tokenMatches(expected, typeof given === "string" ? given : "")) {
    admission?.recordTokenFailure();
    throw new AppError("GATEWAY_TOKEN_INVALID", "admission", "The gateway access token is missing or incorrect.");
  }
}
function isValidRelayUuid(uuid) {
  if (!uuid || Buffer.byteLength(uuid, "utf8") > 128) return false;
  return /^[A-Za-z0-9_-]+$/.test(uuid);
}

// server/bytesCodec.ts
import dns from "node:dns/promises";
import net2 from "node:net";
import nacl from "tweetnacl";
import { blake2b } from "@noble/hashes/blake2.js";
var MAX_FRAME_LENGTH = 16 * 1024 * 1024;
var MAX_RECEIVE_BYTES = MAX_FRAME_LENGTH * 2 + 8;
var MAX_QUEUED_FRAMES = 256;
var RECEIVE_HIGH_BYTES = MAX_FRAME_LENGTH;
var RECEIVE_LOW_BYTES = RECEIVE_HIGH_BYTES / 2;
var RECEIVE_HIGH_FRAMES = MAX_QUEUED_FRAMES / 2;
var RECEIVE_LOW_FRAMES = RECEIVE_HIGH_FRAMES / 2;
var MAX_BUFFERED_CHUNKS = 32768;
var KX_VERSION_LATEST = 1;
var KX_PARAMS_DOMAIN = Buffer.from("rdkx-params", "utf8");
var KX_SPLIT_DOMAIN = Buffer.from("rdkx-spl", "utf8");
function kxVersionFor(advertised) {
  return Math.min(advertised >>> 0, KX_VERSION_LATEST);
}
function encodeBytesFrame(data) {
  const len = data.byteLength;
  if (len > MAX_FRAME_LENGTH) {
    throw new Error(`frame length ${len} exceeds MAX_FRAME_LENGTH`);
  }
  let head;
  if (len <= 63) {
    head = Buffer.allocUnsafe(1);
    head[0] = len << 2 & 255;
  } else if (len <= 16383) {
    head = Buffer.allocUnsafe(2);
    head.writeUInt16LE((len << 2 | 1) & 65535, 0);
  } else if (len <= 4194303) {
    head = Buffer.allocUnsafe(3);
    const h = (len << 2 | 2) >>> 0;
    head.writeUInt16LE(h & 65535, 0);
    head[2] = h >>> 16 & 255;
  } else {
    head = Buffer.allocUnsafe(4);
    head.writeUInt32LE((len << 2 | 3) >>> 0, 0);
  }
  return Buffer.concat([head, Buffer.from(data.buffer, data.byteOffset, data.byteLength)]);
}
var BytesFrameDecoder = class {
  constructor() {
    this.chunks = [];
    this.headIndex = 0;
    this.headOffset = 0;
    this.bufferedBytes = 0;
  }
  get pendingBytes() {
    return this.bufferedBytes;
  }
  clear() {
    this.chunks = [];
    this.headIndex = this.headOffset = this.bufferedBytes = 0;
  }
  // Returning false from onFrame stops parsing this batch without discarding its
  // tail, so a slow consumer can backpressure even a batch of tiny frames.
  push(chunk, onFrame) {
    try {
      return this.decode(chunk, onFrame);
    } catch (error) {
      this.clear();
      throw error;
    }
  }
  decode(chunk, onFrame) {
    if (chunk.length > 0) {
      if (this.bufferedBytes + chunk.length > MAX_RECEIVE_BYTES || this.chunks.length - this.headIndex >= MAX_BUFFERED_CHUNKS) {
        throw new Error("RustDesk receive buffer limit exceeded");
      }
      this.chunks.push(chunk);
      this.bufferedBytes += chunk.length;
    }
    const frames = [];
    while (this.bufferedBytes > 0) {
      const headLen = (this.chunks[this.headIndex][this.headOffset] & 3) + 1;
      if (this.bufferedBytes < headLen) break;
      let n = 0;
      let index = this.headIndex;
      let offset = this.headOffset;
      for (let i = 0; i < headLen; i++) {
        const part = this.chunks[index];
        n |= part[offset++] << 8 * i;
        if (offset === part.length) {
          index++;
          offset = 0;
        }
      }
      const payloadLen = n >>> 2;
      if (payloadLen > MAX_FRAME_LENGTH) {
        throw new Error(`frame overflow: ${payloadLen}`);
      }
      if (this.bufferedBytes < headLen + payloadLen) break;
      if (!onFrame && frames.length >= MAX_QUEUED_FRAMES) throw new Error("RustDesk frame batch limit exceeded");
      this.consume(headLen);
      const frame = Buffer.allocUnsafe(payloadLen);
      this.consume(payloadLen, frame);
      if (this.headIndex === this.chunks.length) {
        this.chunks = [];
        this.headIndex = 0;
      } else if (this.headIndex >= 1024 && this.headIndex * 2 >= this.chunks.length) {
        this.chunks = this.chunks.slice(this.headIndex);
        this.headIndex = 0;
      }
      if (onFrame) {
        if (!onFrame(frame)) break;
      } else frames.push(frame);
    }
    return frames;
  }
  consume(length, target) {
    let written = 0;
    while (written < length) {
      const part = this.chunks[this.headIndex];
      const take = Math.min(length - written, part.length - this.headOffset);
      if (target) part.copy(target, written, this.headOffset, this.headOffset + take);
      this.headOffset += take;
      written += take;
      if (this.headOffset === part.length) {
        this.chunks[this.headIndex++] = void 0;
        this.headOffset = 0;
      }
    }
    this.bufferedBytes -= length;
  }
};
function makeSeqNonce(seq) {
  const nonce = new Uint8Array(24);
  const view = new DataView(nonce.buffer);
  view.setBigUint64(0, seq, true);
  return nonce;
}
function deriveSplitKeys(key, transcript) {
  const meta = Buffer.alloc(8);
  meta.writeUInt32LE(transcript.advertised >>> 0, 0);
  meta.writeUInt32LE(transcript.picked >>> 0, 4);
  const derive = (dirByte) => {
    const input = Buffer.concat([
      KX_SPLIT_DOMAIN,
      Buffer.from([dirByte]),
      meta,
      Buffer.from(transcript.initiatorPk),
      Buffer.from(transcript.responderPk)
    ]);
    return blake2b(input, { key, dkLen: 32 });
  };
  return {
    initiatorToResponder: derive(1),
    responderToInitiator: derive(2)
  };
}
var StreamCipher = class _StreamCipher {
  constructor(sendKey, recvKey) {
    this.sendSeq = 0n;
    this.recvSeq = 0n;
    this.sendKey = new Uint8Array(sendKey);
    this.recvKey = new Uint8Array(recvKey);
  }
  static fromNegotiated(key, isInitiator, transcript) {
    if (transcript.picked === 0) {
      return new _StreamCipher(key, key);
    }
    if (transcript.picked === 1) {
      const split = deriveSplitKeys(key, transcript);
      return isInitiator ? new _StreamCipher(split.initiatorToResponder, split.responderToInitiator) : new _StreamCipher(split.responderToInitiator, split.initiatorToResponder);
    }
    throw new Error(`unsupported kx_version: ${transcript.picked}`);
  }
  seal(plain) {
    this.sendSeq += 1n;
    return nacl.secretbox(plain, makeSeqNonce(this.sendSeq), this.sendKey);
  }
  open(ciphertext) {
    if (ciphertext.byteLength <= 1) {
      return ciphertext;
    }
    this.recvSeq += 1n;
    const plain = nacl.secretbox.open(ciphertext, makeSeqNonce(this.recvSeq), this.recvKey);
    if (!plain) {
      throw new Error("decryption failed on encrypted RustDesk stream");
    }
    return plain;
  }
};
function detectNonRustDeskProtocol(chunk) {
  if (!chunk || chunk.length < 4) return null;
  if ((chunk[0] === 22 || chunk[0] === 21) && chunk[1] === 3 && chunk[2] >= 0 && chunk[2] <= 4) {
    return "tls";
  }
  const head = Buffer.from(chunk.subarray(0, Math.min(chunk.length, 32))).toString("ascii");
  if (/^(?:HTTP\/\d\.\d|GET |POST |HEAD |PUT |DELETE |OPTIONS |<!DOCTYPE|<html|400 Bad Request|404 Not Found)/i.test(
    head
  )) {
    return "http";
  }
  if (/^SSH-\d\.\d/i.test(head)) {
    return "ssh";
  }
  return null;
}
var EncryptedFramedStream = class {
  constructor(socket) {
    this.decoder = new BytesFrameDecoder();
    this.queue = [];
    this.queuedBytes = 0;
    this.receivePaused = false;
    this.waiters = [];
    this.closed = false;
    this.fatalErr = null;
    this.cipher = null;
    this.checkedInitialProtocol = false;
    this.socket = socket;
    socket.setNoDelay(true);
    socket.on("data", (chunk) => {
      if (this.closed) return;
      try {
        if (this.queuedBytes + this.decoder.pendingBytes + chunk.length > MAX_RECEIVE_BYTES) {
          throw new Error("RustDesk receive buffer limit exceeded");
        }
        if (!this.checkedInitialProtocol && !this.cipher && chunk.length > 0) {
          this.checkedInitialProtocol = true;
          const foreign = detectNonRustDeskProtocol(chunk);
          if (foreign === "http") {
            this.fail(
              new Error(
                "Not a RustDesk server: received an HTTP response instead of RustDesk protocol data."
              )
            );
            return;
          }
          if (foreign === "tls") {
            this.fail(
              new Error(
                "Not a RustDesk server: received a TLS/HTTPS response instead of RustDesk protocol data."
              )
            );
            return;
          }
          if (foreign === "ssh") {
            this.fail(
              new Error(
                "Not a RustDesk server: target is an SSH service instead of RustDesk."
              )
            );
            return;
          }
        }
        this.decodeIncoming(chunk);
      } catch (err) {
        this.fail(err instanceof Error ? err : new Error(String(err)));
      }
    });
    socket.on("error", (err) => {
      this.fail(err);
    });
    socket.on("close", () => {
      this.closed = true;
      if (!this.receivePaused) this.decoder.clear();
      while (this.waiters.length > 0) {
        const waiter = this.waiters.shift();
        if (this.fatalErr) waiter.reject(this.fatalErr);
        else waiter.resolve(null);
      }
    });
  }
  static async connect(host, port, timeoutMs, { signal, peerConnection = false } = {}) {
    const config = getRuntimeConfig();
    const cleanHost = host.trim();
    if (!targetHostAllowed(cleanHost)) {
      throw new Error("That target address is not allowed.");
    }
    if (!targetPortAllowed(port, peerConnection, config)) {
      throw new Error("That target port is not allowed.");
    }
    signal?.throwIfAborted();
    const resolved = await resolveDialTargets(cleanHost, Math.min(timeoutMs, 5e3));
    signal?.throwIfAborted();
    const targets = resolved.filter(({ address }) => targetAddressAllowed(address, config.allowPrivateTargets));
    if (targets.length === 0) throw new Error("That target address is not allowed.");
    const deadline = Date.now() + timeoutMs;
    let lastError = null;
    for (let i = 0; i < targets.length; i++) {
      signal?.throwIfAborted();
      const target = targets[i];
      const remaining = deadline - Date.now();
      if (remaining <= 50) {
        break;
      }
      const slotsLeft = targets.length - i;
      const attemptTimeout = slotsLeft > 1 ? Math.max(1500, Math.floor(remaining / slotsLeft)) : remaining;
      try {
        return await dialSingleAddress(target.address, target.family, cleanHost, port, attemptTimeout, signal);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }
    throw lastError ?? new Error(`timed out connecting to ${cleanHost}:${port}`);
  }
  get remoteAddress() {
    return this.socket.remoteAddress;
  }
  fail(err) {
    if (!this.fatalErr) this.fatalErr = err;
    this.closed = true;
    this.clearReceived();
    this.socket.destroy();
    while (this.waiters.length > 0) {
      this.waiters.shift().reject(err);
    }
  }
  clearReceived() {
    this.queue.length = 0;
    this.queuedBytes = 0;
    this.decoder.clear();
    this.receivePaused = false;
  }
  decodeIncoming(chunk) {
    this.decoder.push(chunk, (frame) => {
      if (this.waiters.length) {
        const decrypted = this.cipher ? Buffer.from(this.cipher.open(frame)) : frame;
        this.waiters.shift().resolve(decrypted);
      } else {
        if (this.queue.length >= MAX_QUEUED_FRAMES || this.queuedBytes + frame.length > MAX_RECEIVE_BYTES) {
          throw new Error("RustDesk receive queue limit exceeded");
        }
        this.queue.push(frame);
        this.queuedBytes += frame.length;
      }
      if (this.queue.length >= RECEIVE_HIGH_FRAMES || this.queuedBytes >= RECEIVE_HIGH_BYTES) {
        this.receivePaused = true;
        this.socket.pause();
        return false;
      }
      return true;
    });
  }
  resumeReceiving() {
    if (!this.receivePaused || this.queue.length > RECEIVE_LOW_FRAMES || this.queuedBytes > RECEIVE_LOW_BYTES) return;
    this.receivePaused = false;
    this.decodeIncoming(Buffer.alloc(0));
    if (this.closed && !this.receivePaused) this.decoder.clear();
    if (!this.receivePaused && !this.closed) this.socket.resume();
  }
  isSecured() {
    return this.cipher !== null;
  }
  setNegotiatedKey(key, isInitiator, transcript) {
    this.cipher = StreamCipher.fromNegotiated(key, isInitiator, transcript);
  }
  sendRaw(payload) {
    if (this.closed || this.socket.destroyed) {
      return Promise.reject(this.fatalErr ?? new Error("host closed the connection"));
    }
    const body = this.cipher ? this.cipher.seal(payload) : payload;
    const framed = encodeBytesFrame(body);
    return new Promise((resolve, reject) => {
      this.socket.write(framed, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }
  next(timeoutMs) {
    if (this.fatalErr) return Promise.reject(this.fatalErr);
    if (this.queue.length > 0) {
      const raw = this.queue.shift();
      this.queuedBytes -= raw.length;
      try {
        const decrypted = this.cipher ? Buffer.from(this.cipher.open(raw)) : raw;
        this.resumeReceiving();
        return Promise.resolve(decrypted);
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        this.fail(e);
        return Promise.reject(e);
      }
    }
    if (this.closed) {
      return Promise.resolve(null);
    }
    return new Promise((resolve, reject) => {
      const entry = {
        resolve: (val) => {
          if (timer) clearTimeout(timer);
          resolve(val);
        },
        reject: (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        }
      };
      const timer = timeoutMs && timeoutMs > 0 ? setTimeout(() => {
        const idx = this.waiters.indexOf(entry);
        if (idx !== -1) this.waiters.splice(idx, 1);
        reject(new Error("timed out waiting for host response"));
      }, timeoutMs) : null;
      this.waiters.push(entry);
    });
  }
  close() {
    this.closed = true;
    this.clearReceived();
    while (this.waiters.length) {
      const waiter = this.waiters.shift();
      if (this.fatalErr) waiter.reject(this.fatalErr);
      else waiter.resolve(null);
    }
    this.socket.destroy();
  }
};
function formatNetError(err) {
  if (err && typeof err === "object" && "errors" in err && Array.isArray(err.errors)) {
    const inner = err.errors.map((item) => formatNetError(item)).filter(Boolean);
    if (inner.length > 0) {
      return inner[0];
    }
  }
  if (err instanceof Error) {
    const code = err.code;
    if (err.message) return err.message;
    if (code) return code;
  }
  return String(err ?? "unknown network error");
}
async function resolveDialTargets(host, timeoutMs) {
  const ipFamily = net2.isIP(host);
  if (ipFamily === 4 || ipFamily === 6) {
    return [{ address: host, family: ipFamily }];
  }
  let timer = null;
  try {
    const records = await Promise.race([
      dns.lookup(host, { all: true }),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          const timeoutErr = new Error(`DNS lookup timed out for "${host}" (EAI_AGAIN)`);
          timeoutErr.code = "EAI_AGAIN";
          reject(timeoutErr);
        }, Math.max(1e3, timeoutMs));
      })
    ]);
    if (!Array.isArray(records) || records.length === 0) {
      throw new Error(`DNS lookup failed for "${host}" (ENOTFOUND)`);
    }
    const seen = /* @__PURE__ */ new Set();
    const v4 = [];
    const v6 = [];
    for (const rec of records) {
      if (!rec.address || seen.has(rec.address)) continue;
      seen.add(rec.address);
      if (rec.family === 4) v4.push({ address: rec.address, family: 4 });
      else if (rec.family === 6) v6.push({ address: rec.address, family: 6 });
    }
    const ordered = [...v4, ...v6];
    if (ordered.length === 0) {
      throw new Error(`DNS lookup failed for "${host}" (ENOTFOUND)`);
    }
    return ordered;
  } catch (err) {
    const msg = formatNetError(err);
    if (msg.startsWith("DNS lookup")) {
      throw err instanceof Error ? err : new Error(msg);
    }
    const code = err?.code ?? "ENOTFOUND";
    throw new Error(`DNS lookup failed for "${host}" (${code})`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function dialSingleAddress(address, family, displayHost, port, timeoutMs, signal) {
  return new Promise((resolve, reject) => {
    const socket = net2.createConnection({ host: address, port, family, signal });
    let settled = false;
    const onError = (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        socket.destroy();
        reject(new Error(`failed to connect to ${displayHost}:${port}: ${formatNetError(err)}`));
      }
    };
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.destroy();
        reject(new Error(`timed out connecting to ${displayHost}:${port}`));
      }
    }, timeoutMs);
    socket.on("error", onError);
    socket.once("connect", () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        const stream = new EncryptedFramedStream(socket);
        socket.off("error", onError);
        resolve(stream);
      }
    });
  });
}

// shared/control.ts
import { Buffer as Buffer3 } from "buffer";

// shared/protos.ts
import { Buffer as Buffer2 } from "buffer";

// shared/protoSchema.ts
import protobuf from "protobufjs";

// shared/protoSource.ts
var PROTO_SOURCE = `
syntax = "proto3";
package rustdesk;

// ==================== message.proto ====================

enum KeyboardMode {
  Legacy = 0;
  Map = 1;
  Translate = 2;
  Auto = 3;
}

enum ControlKey {
  Unknown = 0;
  Alt = 1;
  Backspace = 2;
  CapsLock = 3;
  Control = 4;
  Delete = 5;
  DownArrow = 6;
  End = 7;
  Escape = 8;
  F1 = 9;
  F10 = 10;
  F11 = 11;
  F12 = 12;
  F2 = 13;
  F3 = 14;
  F4 = 15;
  F5 = 16;
  F6 = 17;
  F7 = 18;
  F8 = 19;
  F9 = 20;
  Home = 21;
  LeftArrow = 22;
  Meta = 23;
  Option = 24;
  PageDown = 25;
  PageUp = 26;
  Return = 27;
  RightArrow = 28;
  Shift = 29;
  Space = 30;
  Tab = 31;
  UpArrow = 32;
  Numpad0 = 33;
  Numpad1 = 34;
  Numpad2 = 35;
  Numpad3 = 36;
  Numpad4 = 37;
  Numpad5 = 38;
  Numpad6 = 39;
  Numpad7 = 40;
  Numpad8 = 41;
  Numpad9 = 42;
  Cancel = 43;
  Clear = 44;
  Menu = 45;
  Pause = 46;
  Kana = 47;
  Hangul = 48;
  Junja = 49;
  Final = 50;
  Hanja = 51;
  Kanji = 52;
  Convert = 53;
  Select = 54;
  Print = 55;
  Execute = 56;
  Snapshot = 57;
  Insert = 58;
  Help = 59;
  Sleep = 60;
  Separator = 61;
  Scroll = 62;
  NumLock = 63;
  RWin = 64;
  Apps = 65;
  Multiply = 66;
  Add = 67;
  Subtract = 68;
  Decimal = 69;
  Divide = 70;
  Equals = 71;
  NumpadEnter = 72;
  RShift = 73;
  RControl = 74;
  RAlt = 75;
  VolumeMute = 76;
  VolumeUp = 77;
  VolumeDown = 78;
  Power = 79;
  CtrlAltDel = 100;
  LockScreen = 101;
}

enum ImageQuality {
  NotSet = 0;
  Low = 2;
  Balanced = 3;
  Best = 4;
}

enum Chroma {
  I420 = 0;
  I444 = 1;
}

enum ClipboardFormat {
  Text = 0;
  Rtf = 1;
  Html = 2;
  ImageRgba = 21;
  ImagePng = 22;
  ImageSvg = 23;
  Special = 31;
}

message SignedId {
  bytes id = 1;
}

message IdPk {
  string id = 1;
  bytes pk = 2;
  string dtls_fingerprint = 3;
  uint32 kx_version = 4;
}

message PublicKey {
  bytes asymmetric_value = 1;
  bytes symmetric_value = 2;
  uint32 kx_version = 3;
}

message Hash {
  string salt = 1;
  string challenge = 2;
}

message CodecAbility {
  bool vp8 = 1;
  bool vp9 = 2;
  bool av1 = 3;
  bool h264 = 4;
  bool h265 = 5;
}

message SupportedDecoding {
  enum PreferCodec {
    Auto = 0;
    VP9 = 1;
    H264 = 2;
    H265 = 3;
    VP8 = 4;
    AV1 = 5;
  }
  int32 ability_vp9 = 1;
  int32 ability_h264 = 2;
  int32 ability_h265 = 3;
  PreferCodec prefer = 4;
  int32 ability_vp8 = 5;
  int32 ability_av1 = 6;
  CodecAbility i444 = 7;
  Chroma prefer_chroma = 8;
}

message OptionMessage {
  enum BoolOption {
    NotSet = 0;
    No = 1;
    Yes = 2;
  }
  ImageQuality image_quality = 1;
  BoolOption lock_after_session_end = 2;
  BoolOption show_remote_cursor = 3;
  BoolOption privacy_mode = 4;
  BoolOption block_input = 5;
  int32 custom_image_quality = 6;
  BoolOption disable_audio = 7;
  BoolOption disable_clipboard = 8;
  BoolOption enable_file_transfer = 9;
  SupportedDecoding supported_decoding = 10;
  int32 custom_fps = 11;
  BoolOption disable_keyboard = 12;
  BoolOption follow_remote_cursor = 15;
  BoolOption follow_remote_window = 16;
  BoolOption disable_camera = 17;
  BoolOption terminal_persistent = 18;
  BoolOption show_my_cursor = 19;
}

message Resolution {
  int32 width = 1;
  int32 height = 2;
}

message DisplayResolution {
  int32 display = 1;
  Resolution resolution = 2;
}

message SupportedResolutions {
  repeated Resolution resolutions = 1;
}

message DisplayInfo {
  sint32 x = 1;
  sint32 y = 2;
  int32 width = 3;
  int32 height = 4;
  string name = 5;
  bool online = 6;
  bool cursor_embedded = 7;
  Resolution original_resolution = 8;
  double scale = 9;
}

message PortForward {
  string host = 1;
  int32 port = 2;
  bool multiplex = 3;
}

message FileTransfer {
  string dir = 1;
  bool show_hidden = 2;
}

message ViewCamera {}

message Terminal {
  string service_id = 1;
}

message OSLogin {
  string username = 1;
  string password = 2;
}

message LoginRequest {
  string username = 1;
  bytes password = 2;
  string my_id = 4;
  string my_name = 5;
  OptionMessage option = 6;
  oneof union {
    FileTransfer file_transfer = 7;
    PortForward port_forward = 8;
    ViewCamera view_camera = 15;
    Terminal terminal = 16;
  }
  bool video_ack_required = 9;
  uint64 session_id = 10;
  string version = 11;
  OSLogin os_login = 12;
  string my_platform = 13;
  bytes hwid = 14;
  string avatar = 17;
  bytes trusted_device_v2_token = 18;
  bool trusted_device_v2_supported = 19;
}

message Auth2FA {
  string code = 1;
  bytes hwid = 2;
  bool trust_this_device = 3;
}

message ChatMessage {
  string text = 1;
}

message Features {
  bool privacy_mode = 1;
  bool terminal = 2;
  bool port_forward_mux = 3;
}

message SupportedEncoding {
  bool h264 = 1;
  bool h265 = 2;
  bool vp8 = 3;
  bool av1 = 4;
  CodecAbility i444 = 5;
}

message PeerInfo {
  string username = 1;
  string hostname = 2;
  string platform = 3;
  repeated DisplayInfo displays = 4;
  int32 current_display = 5;
  bool sas_enabled = 6;
  string version = 7;
  Features features = 9;
  SupportedEncoding encoding = 10;
  SupportedResolutions resolutions = 11;
  string platform_additions = 12;
}

message LoginResponse {
  oneof union {
    string error = 1;
    PeerInfo peer_info = 2;
  }
  bool enable_trusted_devices = 3;
  bool trusted_device_v2_supported = 4;
  bytes trusted_device_v2_token = 5;
}

message EncodedVideoFrame {
  bytes data = 1;
  bool key = 2;
  int64 pts = 3;
}

message EncodedVideoFrames {
  repeated EncodedVideoFrame frames = 1;
}

message RGB {
  bool compress = 1;
}

message YUV {
  bool compress = 1;
  int32 stride = 2;
}

message VideoFrame {
  oneof union {
    EncodedVideoFrames vp9s = 6;
    RGB rgb = 7;
    YUV yuv = 8;
    EncodedVideoFrames h264s = 10;
    EncodedVideoFrames h265s = 11;
    EncodedVideoFrames vp8s = 12;
    EncodedVideoFrames av1s = 13;
  }
  int32 display = 14;
}

message MouseEvent {
  int32 mask = 1;
  sint32 x = 2;
  sint32 y = 3;
  repeated ControlKey modifiers = 4;
}

message KeyEvent {
  bool down = 1;
  bool press = 2;
  oneof union {
    ControlKey control_key = 3;
    uint32 chr = 4;
    uint32 unicode = 5;
    string seq = 6;
    uint32 win2win_hotkey = 7;
  }
  repeated ControlKey modifiers = 8;
  KeyboardMode mode = 9;
}

message Clipboard {
  bool compress = 1;
  bytes content = 2;
  int32 width = 3;
  int32 height = 4;
  ClipboardFormat format = 5;
  string special_name = 6;
}

message MultiClipboards {
  repeated Clipboard clipboards = 1;
}

message CursorData {
  uint64 id = 1;
  sint32 hotx = 2;
  sint32 hoty = 3;
  int32 width = 4;
  int32 height = 5;
  bytes colors = 6;
}

message CursorPosition {
  sint32 x = 1;
  sint32 y = 2;
}

message AudioFormat {
  uint32 sample_rate = 1;
  uint32 channels = 2;
}

message AudioFrame {
  bytes data = 1;
}

message MessageBox {
  string msgtype = 1;
  string title = 2;
  string text = 3;
  string link = 4;
}

message TestDelay {
  int64 time = 1;
  bool from_client = 2;
  uint32 last_delay = 3;
  uint32 target_bitrate = 4;
}

message SwitchDisplay {
  int32 display = 1;
  sint32 x = 2;
  sint32 y = 3;
  int32 width = 4;
  int32 height = 5;
  bool cursor_embedded = 6;
  SupportedResolutions resolutions = 7;
  Resolution original_resolution = 8;
}

message PermissionInfo {
  enum Permission {
    Keyboard = 0;
    Clipboard = 2;
    Audio = 3;
    File = 4;
    Restart = 5;
    Recording = 6;
    BlockInput = 7;
    PrivacyMode = 8;
  }
  Permission permission = 1;
  bool enabled = 2;
}

message TogglePrivacyMode {
  string impl_key = 1;
  bool on = 2;
}

message BackNotification {
  oneof union {
    int32 privacy_mode_state = 1;
    int32 block_input_state = 2;
  }
  string impl_key = 4;
}

message Misc {
  oneof union {
    int32 follow_current_display = 38;
    ChatMessage chat_message = 4;
    SwitchDisplay switch_display = 5;
    Resolution change_resolution = 24;
    DisplayResolution change_display_resolution = 36;
    PermissionInfo permission_info = 6;
    OptionMessage option = 7;
    AudioFormat audio_format = 8;
    string close_reason = 9;
    BackNotification back_notification = 13;
    TogglePrivacyMode toggle_privacy_mode = 33;
    bool restart_remote_device = 14;
    bool refresh_video = 10;
    bool video_received = 12;
  }
}

message Message {
  oneof union {
    SignedId signed_id = 3;
    PublicKey public_key = 4;
    TestDelay test_delay = 5;
    VideoFrame video_frame = 6;
    LoginRequest login_request = 7;
    LoginResponse login_response = 8;
    Hash hash = 9;
    MouseEvent mouse_event = 10;
    AudioFrame audio_frame = 11;
    CursorData cursor_data = 12;
    CursorPosition cursor_position = 13;
    uint64 cursor_id = 14;
    KeyEvent key_event = 15;
    Clipboard clipboard = 16;
    Misc misc = 19;
    MessageBox message_box = 21;
    PeerInfo peer_info = 25;
    Auth2FA auth_2fa = 27;
    MultiClipboards multi_clipboards = 28;
  }
}

// ==================== rendezvous.proto ====================

enum NatType {
  UNKNOWN_NAT = 0;
  ASYMMETRIC = 1;
  SYMMETRIC = 2;
}

enum ConnType {
  DEFAULT_CONN = 0;
  FILE_TRANSFER = 1;
  PORT_FORWARD = 2;
  RDP = 3;
  VIEW_CAMERA = 4;
  TERMINAL = 5;
}

message PunchHoleRequest {
  string id = 1;
  NatType nat_type = 2;
  string licence_key = 3;
  ConnType conn_type = 4;
  string token = 5;
  string version = 6;
  int32 udp_port = 7;
  bool force_relay = 8;
  int32 upnp_port = 9;
  bytes socket_addr_v6 = 10;
  string switch_code = 11;
  string webrtc_sdp_offer = 12;
}

message PunchHoleSent {
  bytes socket_addr = 1;
  string id = 2;
  string relay_server = 3;
  NatType nat_type = 4;
  string version = 5;
}

message PunchHoleResponse {
  enum Failure {
    ID_NOT_EXIST = 0;
    OFFLINE = 2;
    LICENSE_MISMATCH = 3;
    LICENSE_OVERUSE = 4;
  }
  bytes socket_addr = 1;
  bytes pk = 2;
  Failure failure = 3;
  string relay_server = 4;
  oneof union {
    NatType nat_type = 5;
    bool is_local = 6;
  }
  string other_failure = 7;
  int32 feedback = 8;
  bool is_udp = 9;
  int32 upnp_port = 10;
  bytes socket_addr_v6 = 11;
  string webrtc_sdp_answer = 12;
}

message RequestRelay {
  string id = 1;
  string uuid = 2;
  bytes socket_addr = 3;
  string relay_server = 4;
  bool secure = 5;
  string licence_key = 6;
  ConnType conn_type = 7;
  string token = 8;
}

message RelayResponse {
  bytes socket_addr = 1;
  string uuid = 2;
  string relay_server = 3;
  oneof union {
    string id = 4;
    bytes pk = 5;
  }
  string refuse_reason = 6;
  string version = 7;
  int32 feedback = 9;
  bytes socket_addr_v6 = 10;
  string webrtc_sdp_answer = 12;
}

message KeyExchange {
  repeated bytes keys = 1;
  uint32 version = 2;
  bytes signed_params = 3;
}

message KxParams {
  bytes pk = 1;
  uint32 version = 2;
}

message IceCandidate {
  string id = 1;
  bytes socket_addr = 2;
  string session_key = 3;
  string candidate = 4;
}

message RendezvousMessage {
  oneof union {
    PunchHoleRequest punch_hole_request = 8;
    PunchHoleSent punch_hole_sent = 10;
    PunchHoleResponse punch_hole_response = 11;
    RequestRelay request_relay = 18;
    RelayResponse relay_response = 19;
    KeyExchange key_exchange = 25;
    IceCandidate ice_candidate = 29;
  }
}
`;

// shared/protoSchema.ts
var parsed = protobuf.parse(PROTO_SOURCE, { keepCase: true });
var protoRoot = parsed.root;
var MessageProto = protoRoot.lookupType("rustdesk.Message");
var IdPkProto = protoRoot.lookupType("rustdesk.IdPk");
var RendezvousMessageProto = protoRoot.lookupType("rustdesk.RendezvousMessage");
var KxParamsProto = protoRoot.lookupType("rustdesk.KxParams");
var ControlKeyValues = protoRoot.lookupEnum("rustdesk.ControlKey").values;
var KeyboardModeValues = protoRoot.lookupEnum("rustdesk.KeyboardMode").values;
var ImageQualityValues = protoRoot.lookupEnum("rustdesk.ImageQuality").values;
var BoolOptionValues = protoRoot.lookupEnum("rustdesk.OptionMessage.BoolOption").values;
var PreferCodecValues = protoRoot.lookupEnum("rustdesk.SupportedDecoding.PreferCodec").values;
var ChromaValues = protoRoot.lookupEnum("rustdesk.Chroma").values;
var NatTypeValues = protoRoot.lookupEnum("rustdesk.NatType").values;
var ConnTypeValues = protoRoot.lookupEnum("rustdesk.ConnType").values;
var PunchFailureValues = protoRoot.lookupEnum("rustdesk.PunchHoleResponse.Failure").values;

// shared/protos.ts
function encodeMessage(obj) {
  const msg = MessageProto.create(obj);
  return Buffer2.from(MessageProto.encode(msg).finish());
}
function wrapProtoDecodeError(err, buf, kind) {
  const head = Buffer2.from(buf.subarray(0, Math.min(buf.length, 32))).toString("ascii");
  if (/(?:HTTP\/\d\.\d|<!DOCTYPE|<html|Bad Request|Not Found)/i.test(head)) {
    return new Error(
      kind === "id-server" ? "Not a RustDesk ID server: received an HTTP response instead of RustDesk protocol data." : "Not a RustDesk server: received an HTTP response instead of RustDesk protocol data."
    );
  }
  const msg = err instanceof Error ? err.message : String(err ?? "");
  if (/invalid wire type|index out of range|illegal tag|unexpected end/i.test(msg)) {
    return new Error(
      kind === "id-server" ? "Not a RustDesk ID server: received invalid protocol data." : "Not a RustDesk server: received invalid protocol data."
    );
  }
  return err instanceof Error ? err : new Error(msg);
}
function decodeMessage(buf) {
  try {
    const decoded = MessageProto.decode(buf);
    return MessageProto.toObject(decoded, {
      bytes: Buffer2,
      longs: String,
      enums: Number,
      defaults: false,
      oneofs: true
    });
  } catch (err) {
    throw wrapProtoDecodeError(err, buf, "host");
  }
}
function encodeRendezvous(obj) {
  const msg = RendezvousMessageProto.create(obj);
  return Buffer2.from(RendezvousMessageProto.encode(msg).finish());
}
function decodeRendezvous(buf) {
  try {
    const decoded = RendezvousMessageProto.decode(buf);
    return RendezvousMessageProto.toObject(decoded, {
      bytes: Buffer2,
      longs: String,
      enums: Number,
      defaults: false,
      oneofs: true
    });
  } catch (err) {
    throw wrapProtoDecodeError(err, buf, "id-server");
  }
}
function decodeIdPk(buf) {
  const decoded = IdPkProto.decode(buf);
  const obj = IdPkProto.toObject(decoded, { bytes: Buffer2, defaults: true });
  return {
    id: String(obj.id ?? ""),
    pk: new Uint8Array(obj.pk ?? []),
    kx_version: Number(obj.kx_version ?? 0)
  };
}
function decodeKxParams(buf) {
  const decoded = KxParamsProto.decode(buf);
  const obj = KxParamsProto.toObject(decoded, { bytes: Buffer2, defaults: true });
  return {
    pk: new Uint8Array(obj.pk ?? []),
    version: Number(obj.version ?? 0)
  };
}
function decodeAddrMangle(bytes) {
  if (!bytes || bytes.length === 0) return null;
  if (bytes.length > 16) {
    if (bytes.length !== 18) return null;
    const parts = [];
    for (let i = 0; i < 16; i += 2) {
      parts.push((bytes[i] << 8 | bytes[i + 1]).toString(16));
    }
    const port2 = bytes[16] | bytes[17] << 8;
    if (port2 === 0) return null;
    return { host: parts.join(":"), port: port2 };
  }
  const padded = new Uint8Array(16);
  padded.set(bytes, 0);
  let number = 0n;
  for (let i = 0; i < 16; i++) {
    number |= BigInt(padded[i]) << BigInt(i * 8);
  }
  const tm = number >> 17n & 0xffffffffn;
  const ipNum = Number((number >> 49n) - tm & 0xffffffffn) >>> 0;
  const port = Number((number & 0xffffffn) - (tm & 0xffffn) & 0xffffn);
  if (port === 0) return null;
  const b0 = ipNum & 255;
  const b1 = ipNum >>> 8 & 255;
  const b2 = ipNum >>> 16 & 255;
  const b3 = ipNum >>> 24 & 255;
  return { host: `${b0}.${b1}.${b2}.${b3}`, port };
}

// shared/control.ts
var MOUSE_TYPE_MOVE = 0;
var MOUSE_TYPE_DOWN = 1;
var MOUSE_TYPE_UP = 2;
var MOUSE_TYPE_WHEEL = 3;
var MOUSE_BUTTON_LEFT = 1;
var MOUSE_BUTTON_RIGHT = 2;
var MOUSE_BUTTON_WHEEL = 4;
function selectCodecs(raw) {
  if (!raw || !raw.reported) {
    return {
      vp8: true,
      vp9: true,
      h264: false,
      h265: false,
      av1: false,
      reported: false
    };
  }
  return {
    vp8: Boolean(raw.vp8),
    vp9: Boolean(raw.vp9),
    h264: Boolean(raw.h264),
    h265: Boolean(raw.h265),
    av1: Boolean(raw.av1),
    reported: true
  };
}
function hasAnyCodec(caps) {
  return caps.vp8 || caps.vp9 || caps.h264 || caps.h265 || caps.av1;
}
function packMouseMask(action, button) {
  let kind = MOUSE_TYPE_MOVE;
  if (action === "down") kind = MOUSE_TYPE_DOWN;
  else if (action === "up") kind = MOUSE_TYPE_UP;
  else if (action === "wheel") kind = MOUSE_TYPE_WHEEL;
  let btn = 0;
  if (kind !== MOUSE_TYPE_MOVE && kind !== MOUSE_TYPE_WHEEL) {
    if (button === "right") btn = MOUSE_BUTTON_RIGHT;
    else if (button === "middle") btn = MOUSE_BUTTON_WHEEL;
    else btn = MOUSE_BUTTON_LEFT;
  }
  return btn << 3 | kind;
}
var CONTROL_KEY_MAP = {
  Alt: ControlKeyValues.Alt,
  Backspace: ControlKeyValues.Backspace,
  ArrowLeft: ControlKeyValues.LeftArrow,
  Left: ControlKeyValues.LeftArrow,
  CapsLock: ControlKeyValues.CapsLock,
  Meta: ControlKeyValues.Meta,
  Super: ControlKeyValues.Meta,
  Win: ControlKeyValues.Meta,
  Control: ControlKeyValues.Control,
  Ctrl: ControlKeyValues.Control,
  PageDown: ControlKeyValues.PageDown,
  Delete: ControlKeyValues.Delete,
  PageUp: ControlKeyValues.PageUp,
  ArrowDown: ControlKeyValues.DownArrow,
  Down: ControlKeyValues.DownArrow,
  Enter: ControlKeyValues.Return,
  Return: ControlKeyValues.Return,
  End: ControlKeyValues.End,
  ArrowRight: ControlKeyValues.RightArrow,
  Right: ControlKeyValues.RightArrow,
  Escape: ControlKeyValues.Escape,
  Esc: ControlKeyValues.Escape,
  Shift: ControlKeyValues.Shift,
  F1: ControlKeyValues.F1,
  F2: ControlKeyValues.F2,
  F3: ControlKeyValues.F3,
  F4: ControlKeyValues.F4,
  F5: ControlKeyValues.F5,
  F6: ControlKeyValues.F6,
  F7: ControlKeyValues.F7,
  F8: ControlKeyValues.F8,
  F9: ControlKeyValues.F9,
  F10: ControlKeyValues.F10,
  F11: ControlKeyValues.F11,
  F12: ControlKeyValues.F12,
  Space: ControlKeyValues.Space,
  Tab: ControlKeyValues.Tab,
  ArrowUp: ControlKeyValues.UpArrow,
  Up: ControlKeyValues.UpArrow,
  Home: ControlKeyValues.Home,
  CtrlAltDel: ControlKeyValues.CtrlAltDel,
  LockScreen: ControlKeyValues.LockScreen
};
function controlKeyEnum(name) {
  return CONTROL_KEY_MAP[name];
}
function resolvePreferCodecEnum(codecs, preferCodec) {
  const pref = typeof preferCodec === "string" ? preferCodec.toLowerCase() : "auto";
  if (pref === "h264" && codecs.h264) return PreferCodecValues.H264;
  if (pref === "h265" && codecs.h265) return PreferCodecValues.H265;
  if (pref === "vp8" && codecs.vp8) return PreferCodecValues.VP8;
  if (pref === "vp9" && codecs.vp9) return PreferCodecValues.VP9;
  if (pref === "av1" && codecs.av1) return PreferCodecValues.AV1;
  if (codecs.h264) return PreferCodecValues.H264;
  if (codecs.vp8) return PreferCodecValues.VP8;
  if (codecs.vp9) return PreferCodecValues.VP9;
  if (codecs.h265) return PreferCodecValues.H265;
  return PreferCodecValues.Auto;
}
function buildSupportedDecoding(codecs, preferCodec) {
  const pref = typeof preferCodec === "string" ? preferCodec.toLowerCase() : "auto";
  const explicitAv1 = pref === "av1" && codecs.av1;
  return {
    ability_vp8: codecs.vp8 ? 1 : 0,
    ability_vp9: codecs.vp9 ? 1 : 0,
    // Never advertise AV1 in auto mode so hosts without GPU AV1 do not fall back to 3-7fps software AV1
    ability_av1: explicitAv1 ? 1 : 0,
    ability_h264: codecs.h264 ? 1 : 0,
    ability_h265: codecs.h265 ? 1 : 0,
    prefer: resolvePreferCodecEnum(codecs, pref),
    prefer_chroma: ChromaValues.I420
  };
}
function decodingPreferenceChanged(codecs, previous, next) {
  if (typeof next !== "string" || !next) return false;
  const before = buildSupportedDecoding(codecs, previous);
  const after = buildSupportedDecoding(codecs, next);
  return before.prefer !== after.prefer || before.ability_av1 !== after.ability_av1;
}
function buildQualityOptions(quality, customQuality, fallback) {
  if (quality === "custom") {
    if (typeof customQuality !== "number" || !Number.isInteger(customQuality) || customQuality < 20 || customQuality > 200 || customQuality % 2 !== 0) {
      throw new Error("Custom quality must be an even percentage from 20 to 200.");
    }
    return { image_quality: ImageQualityValues.NotSet, custom_image_quality: customQuality / 2 * 256 };
  }
  return { image_quality: quality === "low" ? ImageQualityValues.Low : quality === "balanced" ? ImageQualityValues.Balanced : quality === "best" ? ImageQualityValues.Best : fallback };
}
function buildLoginOptions(codecs, quality, fps, preferCodec, customQuality, lockAfterSessionEnd = false) {
  const customFps = typeof fps === "number" && Number.isFinite(fps) && fps >= 5 && fps <= 120 ? Math.round(fps) : 30;
  return {
    supported_decoding: buildSupportedDecoding(codecs, preferCodec),
    custom_fps: customFps,
    ...buildQualityOptions(quality, customQuality, ImageQualityValues.Balanced),
    lock_after_session_end: lockAfterSessionEnd === true ? BoolOptionValues.Yes : BoolOptionValues.No,
    disable_audio: BoolOptionValues.Yes,
    show_remote_cursor: BoolOptionValues.Yes
  };
}
function buildVideoReceivedMessage() {
  return {
    misc: {
      video_received: true
    }
  };
}
function buildRefreshVideoMessage() {
  return {
    misc: {
      refresh_video: true
    }
  };
}
function toHostMessage(msg, sessionCodecs) {
  switch (msg.type) {
    case "mouse": {
      return {
        mouse_event: {
          mask: packMouseMask(msg.action, msg.button),
          x: Math.trunc(Number(msg.x ?? 0)),
          y: Math.trunc(Number(msg.y ?? 0))
        }
      };
    }
    case "key": {
      const action = msg.action ?? "down";
      const down = action !== "up";
      const press = action === "press";
      const modifiers = [];
      if (Array.isArray(msg.modifiers)) {
        for (const mod of msg.modifiers) {
          const val = controlKeyEnum(mod);
          if (val !== void 0) modifiers.push(val);
        }
      }
      const ev = {
        mode: KeyboardModeValues.Legacy,
        down,
        press,
        modifiers
      };
      if (msg.control && msg.control.length > 0) {
        ev.control_key = controlKeyEnum(msg.control) ?? ControlKeyValues.Unknown;
      } else if (msg.chr && msg.chr.length > 0) {
        const cp = msg.chr.codePointAt(0);
        if (cp === void 0) return null;
        ev.chr = cp;
      } else if (msg.text && msg.text.length > 0) {
        ev.press = true;
        ev.seq = msg.text;
      } else {
        return null;
      }
      return { key_event: ev };
    }
    case "text": {
      const text = msg.text ?? "";
      if (!text) return null;
      return {
        key_event: {
          mode: KeyboardModeValues.Legacy,
          down: true,
          press: true,
          seq: text
        }
      };
    }
    case "clipboard": {
      const text = msg.text ?? "";
      const bytes = Buffer3.from(text, "utf8");
      if (bytes.byteLength > 256 * 1024) return null;
      return {
        clipboard: {
          compress: false,
          content: bytes
        }
      };
    }
    case "audio":
      if (typeof msg.enabled !== "boolean") return null;
      return { misc: { option: { disable_audio: msg.enabled ? BoolOptionValues.No : BoolOptionValues.Yes } } };
    case "followWindow":
      if (typeof msg.enabled !== "boolean") return null;
      return { misc: { option: { follow_remote_window: msg.enabled ? BoolOptionValues.Yes : BoolOptionValues.No } } };
    case "switchDisplay": {
      return {
        misc: {
          switch_display: {
            display: Math.trunc(Number(msg.display ?? 0))
          }
        }
      };
    }
    case "refresh": {
      return buildRefreshVideoMessage();
    }
    case "lockAfterSessionEnd": {
      if (typeof msg.enabled !== "boolean") return null;
      return { misc: { option: { lock_after_session_end: msg.enabled ? BoolOptionValues.Yes : BoolOptionValues.No } } };
    }
    case "quality": {
      const option = buildQualityOptions(msg.quality, msg.customQuality, ImageQualityValues.NotSet);
      const fps = Math.trunc(Number(msg.fps ?? 0));
      if (fps >= 5 && fps <= 120) {
        option.custom_fps = fps;
      }
      if (msg.codec && sessionCodecs) {
        option.supported_decoding = buildSupportedDecoding(sessionCodecs, msg.codec);
      }
      return {
        misc: { option }
      };
    }
    default:
      return null;
  }
}
function punchHoleFailureMessage(response) {
  const other = String(response.other_failure ?? "").trim();
  if (other) return other;
  switch (response.failure ?? PunchFailureValues.ID_NOT_EXIST) {
    case PunchFailureValues.ID_NOT_EXIST:
      return "ID does not exist";
    case PunchFailureValues.OFFLINE:
      return "remote desktop is offline";
    case PunchFailureValues.LICENSE_MISMATCH:
      return "key mismatch";
    case PunchFailureValues.LICENSE_OVERUSE:
      return "key overuse";
    default:
      return "punch hole failed";
  }
}
function humanizeError(err) {
  const { code, detail } = asAppError(err);
  switch (code) {
    case "PASSWORD_INVALID":
      return "The host rejected the password. Check the permanent password and connect again.";
    case "PASSWORD_REQUIRED":
      return "The host requires a password. Enter the permanent password set on the desktop and connect again.";
    case "DNS_FAILED": {
      const domain = detail.match(/DNS lookup (?:failed|timed out) for "([^"]+)"/i)?.[1];
      return domain ? `DNS lookup failed for "${domain}". Check the domain spelling, remove any http:// prefix, and verify DNS records.` : "DNS lookup failed. Check the server domain spelling and network DNS settings.";
    }
    case "PEER_NOT_FOUND":
      return "ID does not exist. Check the device ID and that both devices use the same ID server.";
    case "PEER_OFFLINE":
      return "The remote desktop is offline. Check that it is powered on, connected to the network, and running RustDesk.";
    case "UNREACHABLE":
      return "Cannot reach the server or host. Check the address, port, and firewall settings.";
    case "TIMEOUT":
      return "The host did not answer in time. It may be offline, or a firewall is blocking the port.";
    case "PROTOCOL_HTTP":
      return "Not a RustDesk ID server: the target returned an HTTP/HTTPS response. Check the server address and port (default 21116 / direct 21118).";
    case "PROTOCOL_INVALID":
      return "Not a RustDesk server: the target returned invalid protocol data. Check the server address and port (default 21116 / direct 21118).";
    case "GATEWAY_TOKEN_INVALID":
      return "The gateway access token is missing or incorrect.";
    default:
      return detail || "The session ended unexpectedly.";
  }
}

// shared/peer.ts
var HostPermission = { Keyboard: 0, Clipboard: 2, Audio: 3, File: 4, Restart: 5, Recording: 6, BlockInput: 7, PrivacyMode: 8 };
var PrivacyState = { Unsupported: 3, Enabled: 4, Disabled: 8, DisabledByPeer: 9 };
function privacyResult(code) {
  return {
    enabled: code === PrivacyState.Enabled ? true : [3, 5, 6, 7, 8, 9, 11].includes(code) ? false : void 0,
    failed: ![PrivacyState.Enabled, PrivacyState.Disabled, PrivacyState.DisabledByPeer].includes(code)
  };
}
function supportsModernDisplayControls(version) {
  const [major, minor, patch] = String(version ?? "").split(".").map(Number);
  return major > 1 || major === 1 && (minor > 2 || minor === 2 && patch >= 4);
}
function permissions(conn) {
  return {
    privacyAllowed: conn.privacyAllowed && conn.peerInfo.features?.privacy_mode === true,
    clipboardAllowed: conn.clipboardAllowed
  };
}
function canRestart(conn) {
  return conn.restartAllowed && ["windows", "mac os", "macos", "linux"].includes(String(conn.peerInfo.platform).toLowerCase());
}
function supportedResolutions(supported) {
  return (supported?.resolutions ?? []).filter((size) => typeof size.width === "number" && typeof size.height === "number" && Number.isInteger(size.width) && Number.isInteger(size.height) && size.width > 0 && size.height > 0);
}
function peerToJson(peer, conn) {
  const displays = Array.isArray(peer.displays) ? peer.displays.map((d, index) => ({
    index,
    name: String(d.name ?? ""),
    x: Number(d.x ?? 0),
    y: Number(d.y ?? 0),
    width: Number(d.width ?? 0),
    height: Number(d.height ?? 0),
    online: Boolean(d.online ?? true),
    cursorEmbedded: Boolean(d.cursor_embedded)
  })) : [];
  const encoding = peer.encoding ? {
    vp8: Boolean(peer.encoding.vp8),
    h264: Boolean(peer.encoding.h264),
    h265: Boolean(peer.encoding.h265),
    av1: Boolean(peer.encoding.av1)
  } : null;
  return {
    type: "peer",
    hostname: String(peer.hostname ?? ""),
    platform: String(peer.platform ?? ""),
    username: String(peer.username ?? ""),
    version: String(peer.version ?? ""),
    currentDisplay: Number(peer.current_display ?? 0),
    displays,
    encoding,
    encrypted: conn.encrypted,
    route: conn.route,
    ...permissions(conn),
    restartAllowed: canRestart(conn)
  };
}
function initialDisplaySize(peer) {
  const displays = Array.isArray(peer.displays) ? peer.displays : [];
  const idx = Number(peer.current_display ?? 0);
  const chosen = displays[idx] ?? displays[0];
  if (!chosen) return { width: 0, height: 0 };
  return {
    width: Math.max(0, Number(chosen.width ?? 0)),
    height: Math.max(0, Number(chosen.height ?? 0))
  };
}

// server/handshake.ts
import crypto2 from "node:crypto";
import nacl2 from "tweetnacl";
function rsPublicKey(keyB64) {
  const trimmed = keyB64.trim();
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length !== 32) {
    throw new Error("server public key must be 32 bytes of standard base64");
  }
  return new Uint8Array(decoded);
}
function createSymmetricKeyMsg(theirPk) {
  const pair = nacl2.box.keyPair();
  const key = new Uint8Array(crypto2.randomBytes(32));
  const zeroNonce = new Uint8Array(24);
  const symmetric = nacl2.box(key, zeroNonce, theirPk, pair.secretKey);
  return {
    asymmetric: pair.publicKey,
    symmetric,
    key
  };
}
async function recvHash(stream, permissions2, timeoutMs = 1e4) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(50, deadline - Date.now());
    const raw = await stream.next(remaining);
    if (!raw) throw new Error("host closed the connection before sending Hash");
    const msg = decodeMessage(raw);
    if (msg.misc?.permission_info?.permission === HostPermission.PrivacyMode) permissions2.privacy = msg.misc.permission_info.enabled === true;
    if (msg.misc?.permission_info?.permission === HostPermission.Clipboard) permissions2.clipboard = msg.misc.permission_info.enabled === true;
    if (msg.misc?.permission_info?.permission === HostPermission.Restart) permissions2.restart = msg.misc.permission_info.enabled === true;
    if (msg.hash) {
      return {
        salt: String(msg.hash.salt ?? ""),
        challenge: String(msg.hash.challenge ?? "")
      };
    }
  }
  throw new Error("timed out waiting for host Hash");
}
async function readUntilHash(stream, peerSignPk, expectedId, permissions2 = { restart: true, privacy: true, clipboard: true }) {
  const raw = await stream.next(1e4);
  if (!raw) throw new Error("host closed the connection during handshake");
  const msg = decodeMessage(raw);
  if (msg.hash) {
    if (peerSignPk) throw new Error("peer signature is required before the Hash challenge");
    return {
      hash: {
        salt: String(msg.hash.salt ?? ""),
        challenge: String(msg.hash.challenge ?? "")
      },
      encrypted: false
    };
  }
  if (msg.signed_id) {
    const signedBytes = new Uint8Array(msg.signed_id.id ?? []);
    let opened = null;
    if (peerSignPk) {
      if (peerSignPk.length !== 32) throw new Error("peer sign public key length is invalid");
      const verified = nacl2.sign.open(signedBytes, peerSignPk);
      if (!verified) throw new Error("peer signature verification failed");
      const parsed2 = decodeIdPk(verified);
      if (parsed2.pk.length !== 32) throw new Error("peer signed public key length is invalid");
      if (expectedId && parsed2.id !== expectedId) throw new Error("peer signed identity does not match the requested ID");
      opened = parsed2;
    }
    if (!opened) {
      await stream.sendRaw(encodeMessage({ public_key: {} }));
      const hash2 = await recvHash(stream, permissions2);
      return { hash: hash2, encrypted: false };
    }
    const { asymmetric, symmetric, key } = createSymmetricKeyMsg(opened.pk);
    const picked = kxVersionFor(opened.kx_version);
    await stream.sendRaw(
      encodeMessage({
        public_key: {
          asymmetric_value: Buffer.from(asymmetric),
          symmetric_value: Buffer.from(symmetric),
          kx_version: picked
        }
      })
    );
    stream.setNegotiatedKey(key, true, {
      initiatorPk: asymmetric,
      responderPk: opened.pk,
      advertised: opened.kx_version,
      picked
    });
    const hash = await recvHash(stream, permissions2);
    return { hash, encrypted: true };
  }
  throw new Error("expected Hash or SignedId, got another message");
}
function peerSignKey(serverKeyB64, signedPk, expectedPeerId) {
  if (!serverKeyB64.trim()) return null;
  const rsPk = rsPublicKey(serverKeyB64);
  if (!signedPk?.length) throw new Error("identity server did not provide a signed peer public key");
  const verified = nacl2.sign.open(signedPk, rsPk);
  if (!verified) {
    throw new Error("identity server signature verification failed");
  }
  const opened = decodeIdPk(verified);
  const normalizedExpected = expectedPeerId.replace(/\s+/g, "");
  if (opened.id !== normalizedExpected) {
    throw new Error(`identity server signed a different id (${opened.id})`);
  }
  if (opened.pk.length !== 32) {
    throw new Error("peer sign public key length is invalid");
  }
  return opened.pk;
}
async function secureRendezvous(stream, keyB64, probeTimeoutMs = 700) {
  if (!keyB64.trim()) return false;
  const rsPk = rsPublicKey(keyB64);
  let raw;
  try {
    raw = await stream.next(probeTimeoutMs);
  } catch (err) {
    if (err instanceof Error && /timed out/i.test(err.message)) {
      return false;
    }
    throw err;
  }
  if (!raw) throw new Error("rendezvous server closed connection during key exchange");
  const msg = decodeRendezvous(raw);
  const ex = msg.key_exchange;
  if (!ex) {
    return false;
  }
  const keys = ex.keys ?? [];
  if (keys.length !== 1) {
    throw new Error(`expected 1 key in KeyExchange, got ${keys.length}`);
  }
  const their = nacl2.sign.open(new Uint8Array(keys[0]), rsPk);
  if (!their || their.length !== 32) {
    throw new Error("key mismatch: rendezvous server key signature is invalid");
  }
  const version = Number(ex.version ?? 0);
  const signedParams = ex.signed_params;
  if ((their[31] & 128) !== 0 || signedParams && signedParams.length > 0) {
    if (!signedParams || signedParams.length === 0) {
      throw new Error("missing signed_params in rendezvous KeyExchange");
    }
    const openedParams = nacl2.sign.open(new Uint8Array(signedParams), rsPk);
    if (!openedParams || openedParams.length < KX_PARAMS_DOMAIN.length) {
      throw new Error("invalid signed_params signature in rendezvous KeyExchange");
    }
    const prefix = Buffer.from(openedParams.subarray(0, KX_PARAMS_DOMAIN.length));
    if (!prefix.equals(KX_PARAMS_DOMAIN)) {
      throw new Error("invalid signed_params domain prefix");
    }
    const params = decodeKxParams(openedParams.subarray(KX_PARAMS_DOMAIN.length));
    if (params.version !== version || !Buffer.from(params.pk).equals(Buffer.from(their))) {
      throw new Error("signed_params mismatch in rendezvous KeyExchange");
    }
  }
  const { asymmetric, symmetric, key } = createSymmetricKeyMsg(their);
  const picked = kxVersionFor(version);
  await stream.sendRaw(
    encodeRendezvous({
      key_exchange: {
        keys: [Buffer.from(asymmetric), Buffer.from(symmetric)],
        version: picked
      }
    })
  );
  stream.setNegotiatedKey(key, true, {
    initiatorPk: asymmetric,
    responderPk: their,
    advertised: version,
    picked
  });
  return true;
}

// shared/webrtc.ts
import { Buffer as Buffer4 } from "buffer";
var MAX_ENDPOINT_LENGTH = 32 * 1024;
var MAX_CANDIDATES = 128;
var MAX_MESSAGE_BYTES = 64 * 1024 * 1024;
function sdpFingerprint(sdp) {
  const values = [...sdp.matchAll(/^a=fingerprint:([^\r\n]+)/gm)].map((match) => match[1].trim());
  if (!values.length || values.some((value) => value !== values[0]) || !/^sha-256 (?:[\da-f]{2}:){31}[\da-f]{2}$/i.test(values[0])) {
    throw new Error("Invalid WebRTC certificate fingerprint");
  }
  return values[0];
}
function decodeEndpoint(endpoint, type) {
  if (typeof endpoint !== "string" || endpoint.length > MAX_ENDPOINT_LENGTH || !endpoint.startsWith("webrtc://")) {
    throw new Error("Invalid WebRTC endpoint");
  }
  const value = JSON.parse(Buffer4.from(endpoint.slice(9), "base64").toString("utf8"));
  if (value.type !== type || typeof value.sdp !== "string" || !value.sdp.includes("m=application ")) {
    throw new Error("Invalid WebRTC session description");
  }
  sdpFingerprint(value.sdp);
  return { type, sdp: value.sdp };
}
function validateCandidate(value) {
  if (typeof value !== "string" || value.length > 8192) throw new Error("Invalid ICE candidate");
  const parsed2 = JSON.parse(value);
  if (!parsed2 || typeof parsed2.candidate !== "string" || parsed2.candidate.length > 4096 || parsed2.sdpMid != null && typeof parsed2.sdpMid !== "string" || parsed2.sdpMLineIndex != null && (!Number.isInteger(parsed2.sdpMLineIndex) || parsed2.sdpMLineIndex < 0)) {
    throw new Error("Invalid ICE candidate");
  }
  return value;
}

// server/webrtcSignal.ts
function serveWebRtcSignal(ws, token, admission) {
  let state = "waiting";
  const connection = new AbortController();
  let stream = null;
  let peerId = "";
  let sessionKey = "";
  let sentCandidates = 0;
  let receivedCandidates = 0;
  const retries = /* @__PURE__ */ new Set();
  const send = (value) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(value));
  };
  const close = () => {
    state = "closed";
    connection.abort();
    clearTimeout(deadline);
    retries.forEach(clearTimeout);
    retries.clear();
    stream?.close();
    stream = null;
    if (ws.readyState === ws.OPEN) ws.close();
  };
  const fail = (error) => {
    if (state === "closed") return;
    send({ type: "error", message: error instanceof Error ? error.message : "WebRTC signaling failed", ...errorPayload(error, "signaling") });
    close();
  };
  const deadline = setTimeout(() => fail(new Error("WebRTC signaling timed out")), 2e4);
  deadline.unref?.();
  ws.on("close", close);
  ws.on("error", close);
  ws.on("message", (data, binary) => {
    void (async () => {
      if (state === "closed") return;
      if (binary || Buffer.byteLength(data) > 48 * 1024) throw new Error("Invalid signaling message");
      let message;
      try {
        message = JSON.parse(data.toString());
        if (!message || typeof message !== "object" || Array.isArray(message)) throw new Error();
      } catch {
        throw new AppError("INVALID_REQUEST", "input", "Invalid signaling message");
      }
      if (state === "waiting") {
        if (message.type !== "offer") throw new Error("Send a WebRTC offer first");
        authenticateGateway(token, message.token, admission);
        if (typeof message.peerId !== "string" || !/^\d{6,16}$/.test(message.peerId) || typeof message.idServer !== "string" || !message.idServer.trim() || message.idServer.length > 512 || typeof message.key !== "string" || message.key.length > 256 || typeof message.offer !== "string") {
          throw new AppError("INVALID_REQUEST", "signaling", "Invalid ID server or peer ID");
        }
        const offer = decodeEndpoint(message.offer, "offer");
        sessionKey = sdpFingerprint(offer.sdp);
        peerId = message.peerId;
        state = "dialing";
        const dial = checkPort(message.idServer, RENDEZVOUS_PORT);
        const connected = await EncryptedFramedStream.connect(dial.host, dial.port, 5e3, { signal: connection.signal });
        if (state === "closed") {
          connected.close();
          return;
        }
        stream = connected;
        if (message.key.trim()) await secureRendezvous(connected, message.key);
        if (state === "closed") return;
        await connected.sendRaw(encodeRendezvous({ punch_hole_request: {
          id: peerId,
          licence_key: message.key.trim(),
          nat_type: 0,
          conn_type: 0,
          version: "1.5.3",
          webrtc_sdp_offer: message.offer
        } }));
        if (state === "closed") return;
        state = "ready";
        send({ type: "ready" });
        while (state === "ready") {
          const raw = await connected.next(15e3);
          if (!raw) throw new Error("ID server closed WebRTC signaling");
          const incoming = decodeRendezvous(raw);
          const ice = incoming.ice_candidate;
          if (ice && ice.session_key === sessionKey && receivedCandidates++ < MAX_CANDIDATES) {
            send({ type: "candidate", candidate: validateCandidate(ice.candidate) });
          }
          const answer = incoming.punch_hole_response ?? incoming.relay_response;
          if (answer) {
            const refusal = String(incoming.punch_hole_response?.other_failure ?? "").trim() || String(incoming.relay_response?.refuse_reason ?? "").trim();
            if (refusal) throw new Error(refusal);
            if (!answer.webrtc_sdp_answer) {
              if (incoming.punch_hole_response && (incoming.punch_hole_response.failure !== void 0 || !answer.socket_addr?.length && !answer.socket_addr_v6?.length)) {
                throw new Error(punchHoleFailureMessage(incoming.punch_hole_response));
              }
              throw new Error("This peer or ID server did not offer WebRTC");
            }
            decodeEndpoint(answer.webrtc_sdp_answer, "answer");
            send({
              type: "answer",
              answer: answer.webrtc_sdp_answer,
              signedPk: Buffer.from(answer.pk ?? []).toString("base64")
            });
          }
        }
        return;
      }
      if (state !== "ready" || message.type !== "candidate" || ++sentCandidates > MAX_CANDIDATES) {
        throw new Error("Unexpected ICE candidate");
      }
      const packet = encodeRendezvous({ ice_candidate: {
        id: peerId,
        session_key: sessionKey,
        candidate: validateCandidate(message.candidate)
      } });
      await stream.sendRaw(packet);
      const retry = setTimeout(() => {
        retries.delete(retry);
        if (state === "ready") void stream.sendRaw(packet).catch(fail);
      }, 400);
      retries.add(retry);
    })().catch(fail);
  });
  return close;
}

// server/rustdeskClient.ts
import crypto3 from "node:crypto";
async function loginHost(stream, hash, username, password, codecs, encrypted, route, permissions2, quality, fps, preferCodec, customQuality, lockAfterSessionEnd) {
  const loginOption = buildLoginOptions(codecs, quality, fps, preferCodec, customQuality, lockAfterSessionEnd);
  const loginReq = {
    login_request: {
      username,
      password: passwordResponse(password, hash.salt, hash.challenge),
      my_id: "web-client",
      my_name: "Web Client",
      my_platform: "Web",
      version: "1.5.3",
      option: loginOption
    }
  };
  await stream.sendRaw(encodeMessage(loginReq));
  const deadline = Date.now() + 2e4;
  while (Date.now() < deadline) {
    const remaining = Math.max(50, deadline - Date.now());
    const raw = await stream.next(remaining);
    if (!raw) throw new Error("host closed the connection before LoginResponse");
    const msg = decodeMessage(raw);
    if (msg.misc?.permission_info?.permission === HostPermission.PrivacyMode) permissions2.privacy = msg.misc.permission_info.enabled === true;
    if (msg.misc?.permission_info?.permission === HostPermission.Clipboard) permissions2.clipboard = msg.misc.permission_info.enabled === true;
    if (msg.misc?.permission_info?.permission === HostPermission.Restart) permissions2.restart = msg.misc.permission_info.enabled === true;
    if (msg.login_response) {
      if (msg.login_response.error !== void 0 && msg.login_response.union === "error") {
        const reason = String(msg.login_response.error || "").trim();
        throw new Error(reason || "the host rejected the login");
      }
      if (msg.login_response.peer_info) {
        await stream.sendRaw(encodeMessage({ misc: { option: loginOption } }));
        await stream.sendRaw(encodeMessage(buildRefreshVideoMessage()));
        return {
          stream,
          route,
          restartAllowed: permissions2.restart,
          privacyAllowed: permissions2.privacy,
          clipboardAllowed: permissions2.clipboard,
          peerInfo: msg.login_response.peer_info,
          username,
          encrypted
        };
      }
    }
    if (msg.peer_info) {
      await stream.sendRaw(encodeMessage({ misc: { option: loginOption } }));
      await stream.sendRaw(encodeMessage(buildRefreshVideoMessage()));
      return {
        stream,
        route,
        restartAllowed: permissions2.restart,
        privacyAllowed: permissions2.privacy,
        clipboardAllowed: permissions2.clipboard,
        peerInfo: msg.peer_info,
        username,
        encrypted
      };
    }
    if (msg.auth_2fa) {
      throw new Error("The host requires two-factor authentication, which is not yet enabled on this gateway.");
    }
    if (msg.misc?.close_reason) {
      const reason = String(msg.misc.close_reason).trim();
      throw new Error(reason || "the host closed the session");
    }
    if (msg.message_box?.text) {
      throw new Error(String(msg.message_box.text).trim());
    }
  }
  throw new Error("timed out waiting for LoginResponse");
}
async function connectDirect(target, codecs, signal) {
  const host = target.host.trim();
  if (!host) throw new Error("host address is empty");
  const port = target.port > 0 ? target.port : DEFAULT_DIRECT_PORT;
  const dial = checkPort(host, port);
  const stream = await EncryptedFramedStream.connect(dial.host, dial.port, 8e3, { signal, peerConnection: true });
  try {
    const username = directUsername(host, dial.port, stream.remoteAddress);
    const permissions2 = { restart: true, privacy: true, clipboard: true };
    const { hash, encrypted } = await readUntilHash(stream, null, "", permissions2);
    return await loginHost(
      stream,
      hash,
      username,
      target.password,
      codecs,
      encrypted,
      "direct",
      permissions2,
      target.quality,
      target.fps,
      target.preferCodec,
      target.customQuality,
      target.lockAfterSessionEnd
    );
  } catch (err) {
    stream.close();
    throw err;
  }
}
async function nextNonKeyExchange(stream, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const remaining = Math.max(50, deadline - Date.now());
    const raw = await stream.next(remaining);
    if (!raw) return null;
    const msg = decodeRendezvous(raw);
    if (msg.key_exchange) continue;
    return msg;
  }
  return null;
}
async function requestRelayViaRendezvous(target, idDial, suggestedRelayServer, secure, idServerSecured, signal) {
  const peerId = target.peerId.replace(/\s+/g, "");
  const relaySocket = await EncryptedFramedStream.connect(idDial.host, idDial.port, 1e4, { signal });
  try {
    if (idServerSecured && target.key.trim()) {
      await secureRendezvous(relaySocket, target.key, 1500);
    }
    const uuid = crypto3.randomUUID();
    const relayServer = target.relayServer.trim() || suggestedRelayServer.trim();
    await relaySocket.sendRaw(
      encodeRendezvous({
        request_relay: {
          id: peerId,
          uuid,
          relay_server: relayServer,
          secure,
          licence_key: target.key.trim(),
          conn_type: ConnTypeValues.DEFAULT_CONN
        }
      })
    );
    const resp = await nextNonKeyExchange(relaySocket, 12e3);
    if (!resp || !resp.relay_response) {
      throw new Error("id server did not confirm relay request");
    }
    const rr = resp.relay_response;
    const refuse = String(rr.refuse_reason ?? "").trim();
    if (refuse) throw new Error(refuse);
    const finalUuid = String(rr.uuid || uuid);
    if (!isValidRelayUuid(finalUuid)) {
      throw new Error("invalid relay uuid");
    }
    const finalRelayHost = target.relayServer.trim() || String(rr.relay_server ?? "").trim() || suggestedRelayServer.trim() || idDial.host;
    if (!finalRelayHost) throw new Error("relay server is empty");
    const defaultRelayPort = idDial.port > 0 && idDial.port < 65535 ? idDial.port + 1 : RELAY_PORT;
    const peerStream = await connectRelayEndpoint(
      finalRelayHost,
      peerId,
      finalUuid,
      target.key.trim(),
      defaultRelayPort,
      signal
    );
    const pkBytes = rr.pk ? new Uint8Array(rr.pk) : void 0;
    relaySocket.close();
    return { peerStream, pkBytes };
  } catch (err) {
    relaySocket.close();
    throw err;
  }
}
async function connectRelayEndpoint(relayHost, peerId, uuid, licenceKey, defaultRelayPort, signal) {
  const relayDial = checkPort(relayHost, defaultRelayPort);
  const peerStream = await EncryptedFramedStream.connect(relayDial.host, relayDial.port, 1e4, { signal });
  try {
    await peerStream.sendRaw(
      encodeRendezvous({
        request_relay: {
          id: peerId,
          uuid,
          licence_key: licenceKey,
          conn_type: ConnTypeValues.DEFAULT_CONN
        }
      })
    );
    return peerStream;
  } catch (err) {
    peerStream.close();
    throw err;
  }
}
async function raceRoutes(direct, relay, signal) {
  signal?.throwIfAborted();
  const directAbort = new AbortController();
  const relayAbort = new AbortController();
  const directSignal = signal ? AbortSignal.any([signal, directAbort.signal]) : directAbort.signal;
  const relaySignal = signal ? AbortSignal.any([signal, relayAbort.signal]) : relayAbort.signal;
  let startRelay;
  const relayReady = new Promise((resolve) => {
    startRelay = resolve;
  });
  const timer = setTimeout(startRelay, 350);
  let winner;
  try {
    winner = await Promise.any([
      direct(directSignal).catch((err) => {
        startRelay();
        throw err;
      }),
      (async () => {
        await relayReady;
        relaySignal.throwIfAborted();
        return relay(relaySignal);
      })()
    ]);
    signal?.throwIfAborted();
    return winner;
  } catch (err) {
    winner?.stream.close();
    winner = void 0;
    signal?.throwIfAborted();
    if (err instanceof AggregateError) {
      const reasons = err.errors.map((reason) => reason instanceof Error ? reason.message : String(reason));
      throw new AggregateError(err.errors, `Direct connection failed: ${reasons[0]}; relay connection failed: ${reasons[1]}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    startRelay();
    if (winner?.route !== "direct") directAbort.abort();
    if (winner?.route !== "relay") relayAbort.abort();
  }
}
async function connectViaId(target, codecs, signal) {
  const peerId = target.peerId.replace(/\s+/g, "");
  const idServer = target.idServer.trim();
  const forceRelay = target.forceRelay || getRuntimeConfig().defaultForceRelay;
  if (!peerId) throw new Error("peer id is empty");
  if (!idServer) throw new Error("id server is empty");
  const idDial = checkPort(idServer, RENDEZVOUS_PORT);
  const idSocket = await EncryptedFramedStream.connect(idDial.host, idDial.port, 1e4, { signal });
  let peerStream = null;
  let idServerSecured = false;
  try {
    if (target.key.trim()) {
      idServerSecured = await secureRendezvous(idSocket, target.key);
    }
    await idSocket.sendRaw(
      encodeRendezvous({
        punch_hole_request: {
          id: peerId,
          licence_key: target.key.trim(),
          nat_type: forceRelay ? NatTypeValues.SYMMETRIC : NatTypeValues.UNKNOWN_NAT,
          conn_type: ConnTypeValues.DEFAULT_CONN,
          force_relay: forceRelay,
          version: "1.5.3"
        }
      })
    );
    const deadline = Date.now() + 2e4;
    while (Date.now() < deadline) {
      const remaining = Math.max(50, deadline - Date.now());
      const msg = await nextNonKeyExchange(idSocket, remaining);
      if (!msg) throw new Error("id server closed the connection");
      if (msg.punch_hole_response) {
        const ph = msg.punch_hole_response;
        const addrBytes = ph.socket_addr;
        const relayHint = String(ph.relay_server ?? "").trim();
        if (!addrBytes || addrBytes.length === 0) {
          throw new Error(punchHoleFailureMessage(ph));
        }
        const signedPk = ph.pk ? new Uint8Array(ph.pk) : void 0;
        const signPk = peerSignKey(target.key, signedPk, peerId);
        idSocket.close();
        const prepareRelay = async (attemptSignal) => {
          const relay = await requestRelayViaRendezvous(
            target,
            idDial,
            relayHint,
            Boolean(signPk),
            idServerSecured,
            attemptSignal
          );
          try {
            const finalSignPk = signPk ?? peerSignKey(target.key, relay.pkBytes, peerId);
            const permissions2 = { restart: true, privacy: true, clipboard: true };
            const handshake = await readUntilHash(relay.peerStream, finalSignPk, peerId, permissions2);
            attemptSignal?.throwIfAborted();
            return { stream: relay.peerStream, route: "relay", permissions: permissions2, ...handshake };
          } catch (err) {
            relay.peerStream.close();
            throw err;
          }
        };
        const decodedAddr = forceRelay ? null : decodeAddrMangle(new Uint8Array(addrBytes));
        const ready = decodedAddr ? await raceRoutes(async (attemptSignal) => {
          const stream = await EncryptedFramedStream.connect(
            decodedAddr.host,
            decodedAddr.port,
            3500,
            { signal: attemptSignal, peerConnection: true }
          );
          try {
            const permissions2 = { restart: true, privacy: true, clipboard: true };
            const handshake = await readUntilHash(stream, signPk, peerId, permissions2);
            attemptSignal.throwIfAborted();
            return { stream, route: "direct", permissions: permissions2, ...handshake };
          } catch (err) {
            stream.close();
            throw err;
          }
        }, prepareRelay, signal) : await prepareRelay(signal);
        peerStream = ready.stream;
        return await loginHost(
          peerStream,
          ready.hash,
          peerId,
          target.password,
          codecs,
          ready.encrypted,
          ready.route,
          ready.permissions,
          target.quality,
          target.fps,
          target.preferCodec,
          target.customQuality,
          target.lockAfterSessionEnd
        );
      }
      if (msg.relay_response) {
        const rr = msg.relay_response;
        const refuse = String(rr.refuse_reason ?? "").trim();
        if (refuse) throw new Error(refuse);
        const uuid = String(rr.uuid ?? "");
        if (!isValidRelayUuid(uuid)) {
          throw new Error("invalid relay uuid");
        }
        const relayHost = target.relayServer.trim() || String(rr.relay_server ?? "").trim() || idDial.host;
        if (!relayHost) throw new Error("relay server is empty");
        const defaultRelayPort = idDial.port > 0 && idDial.port < 65535 ? idDial.port + 1 : RELAY_PORT;
        peerStream = await connectRelayEndpoint(
          relayHost,
          peerId,
          uuid,
          target.key.trim(),
          defaultRelayPort,
          signal
        );
        const pkBytes = rr.pk ? new Uint8Array(rr.pk) : void 0;
        const signPk = peerSignKey(target.key, pkBytes, peerId);
        const permissions2 = { restart: true, privacy: true, clipboard: true };
        const { hash, encrypted } = await readUntilHash(peerStream, signPk, peerId, permissions2);
        idSocket.close();
        return await loginHost(
          peerStream,
          hash,
          peerId,
          target.password,
          codecs,
          encrypted,
          "relay",
          permissions2,
          target.quality,
          target.fps,
          target.preferCodec,
          target.customQuality,
          target.lockAfterSessionEnd
        );
      }
    }
    throw new Error("timed out waiting for rendezvous response");
  } catch (err) {
    idSocket.close();
    if (peerStream) peerStream.close();
    throw err;
  }
}

// server/clientMessages.ts
function createClientMessageHandler(context) {
  const { state, ws, videoBuffer, sendJson, cleanup, config, connectionSignal, clearConnectDeadline, startHostPump: startHostPump2 } = context;
  const forwardToHost = (hostMsg, refreshVideo = false) => {
    const activeHost = state.hostConn;
    if (hostMsg && activeHost) {
      void activeHost.stream.sendRaw(encodeMessage(hostMsg)).catch((err) => {
        if (state.phase === "live") {
          sendJson({ type: "status", state: "error", ...errorPayload(err) });
          cleanup(false);
        }
      });
      if (refreshVideo) {
        void activeHost.stream.sendRaw(encodeMessage(buildRefreshVideoMessage())).catch(() => {
        });
      }
    }
  };
  const forwardControl = (parsed2) => {
    forwardToHost(toHostMessage(parsed2, state.sessionCodecs));
  };
  const handlers = {
    ping: (parsed2) => {
      const seq = Number.isFinite(Number(parsed2.seq)) ? Number(parsed2.seq) : 0;
      const clientTs = Number.isFinite(Number(parsed2.clientTs)) ? Number(parsed2.clientTs) : 0;
      sendJson({
        type: "pong",
        seq,
        clientTs,
        serverTs: Date.now(),
        ...state.phase === "live" && {
          gatewayVideo: {
            queuedBytes: ws.bufferedAmount,
            droppedFrames: videoBuffer.droppedFrames,
            recovering: videoBuffer.recovering
          }
        }
      });
    },
    disconnect: () => {
      cleanup(true);
    },
    connect: async (parsed2) => {
      if (state.phase !== "awaiting-connect") {
        sendJson({ type: "error", message: "already connected" });
        return;
      }
      clearConnectDeadline();
      try {
        authenticateGateway(config.token, parsed2.token, config.admission);
      } catch (error) {
        sendJson({ type: "status", state: "error", ...errorPayload(error) });
        cleanup(false);
        return;
      }
      const codecs = selectCodecs(parsed2.codecs);
      if (!hasAnyCodec(codecs)) {
        sendJson({
          type: "status",
          state: "error",
          ...errorPayload(new AppError("CODEC_UNSUPPORTED", "codec", "This browser cannot decode VP8, VP9, H.264, HEVC, or AV1."))
        });
        cleanup(false);
        return;
      }
      state.sessionCodecs = codecs;
      state.phase = "connecting";
      sendJson({ type: "status", state: "connecting", detail: "dialing the host" });
      try {
        const conn = parsed2.mode === "id" ? await connectViaId(
          {
            peerId: parsed2.peerId ?? "",
            password: parsed2.password ?? "",
            idServer: parsed2.idServer ?? "",
            relayServer: parsed2.relayServer ?? "",
            key: parsed2.key ?? "",
            forceRelay: Boolean(parsed2.forceRelay),
            quality: parsed2.quality,
            customQuality: parsed2.customQuality,
            lockAfterSessionEnd: parsed2.lockAfterSessionEnd === true,
            fps: parsed2.fps,
            preferCodec: parsed2.codec
          },
          codecs,
          connectionSignal
        ) : await connectDirect(
          {
            host: parsed2.host ?? "",
            port: Number(parsed2.port ?? 0),
            password: parsed2.password ?? "",
            quality: parsed2.quality,
            customQuality: parsed2.customQuality,
            lockAfterSessionEnd: parsed2.lockAfterSessionEnd === true,
            fps: parsed2.fps,
            preferCodec: parsed2.codec
          },
          codecs,
          connectionSignal
        );
        if (state.phase !== "connecting") {
          conn.stream.close();
          return;
        }
        state.preferredCodec = parsed2.codec;
        state.hostConn = conn;
        state.phase = "live";
        void startHostPump2(conn);
      } catch (err) {
        if (state.phase !== "closed") {
          sendJson({ type: "status", state: "error", ...errorPayload(err) });
          cleanup(false);
        }
      }
    },
    clipboard: (parsed2) => {
      const conn = state.hostConn;
      if (!conn || !conn.clipboardAllowed || typeof parsed2.text !== "string") return;
      forwardControl(parsed2);
    },
    privacy: async (parsed2) => {
      const conn = state.hostConn;
      if (!conn) return;
      if (!permissions(conn).privacyAllowed || typeof parsed2.enabled !== "boolean") {
        sendJson({ type: "privacyResult", failed: true });
        return;
      }
      const modern = supportsModernDisplayControls(conn.peerInfo.version);
      const misc = modern ? { toggle_privacy_mode: { on: parsed2.enabled, impl_key: state.privacyImpl } } : { option: { privacy_mode: parsed2.enabled ? 2 : 1 } };
      try {
        await conn.stream.sendRaw(encodeMessage({ misc }));
      } catch {
        sendJson({ type: "privacyResult", failed: true });
      }
    },
    restart: async () => {
      const conn = state.hostConn;
      if (!conn) return;
      if (!canRestart(conn)) {
        sendJson({ type: "restartResult", sent: false });
        return;
      }
      try {
        await conn.stream.sendRaw(encodeMessage({ misc: { restart_remote_device: true } }));
        sendJson({ type: "restartResult", sent: true });
      } catch {
        sendJson({ type: "restartResult", sent: false });
      }
    },
    audio: (parsed2) => {
      if (typeof parsed2.enabled !== "boolean") return;
      if (parsed2.enabled && !state.audioAllowed) {
        sendJson({ type: "audioDenied" });
        return;
      }
      state.audioRequested = parsed2.enabled;
      if (state.audioRequested && state.audioFormat) sendJson({ type: "audioFormat", ...state.audioFormat });
      forwardControl(parsed2);
    },
    resolution: (parsed2) => {
      const conn = state.hostConn;
      if (!conn) return;
      const { display, width, height } = parsed2;
      if (display !== state.resolutionDisplay || !state.sizes.some((size) => size.width === width && size.height === height)) {
        sendJson({ type: "error", message: "The active display does not offer that resolution." });
        return;
      }
      const modern = supportsModernDisplayControls(conn.peerInfo.version ?? "");
      const resolution = { width, height };
      const hostMsg = { misc: modern ? { change_display_resolution: { display, resolution } } : { change_resolution: resolution } };
      forwardToHost(hostMsg);
    },
    quality: (parsed2) => {
      try {
        const refreshVideo = Boolean(state.sessionCodecs && decodingPreferenceChanged(state.sessionCodecs, state.preferredCodec, parsed2.codec));
        const hostMsg = toHostMessage(refreshVideo ? parsed2 : { ...parsed2, codec: void 0 }, state.sessionCodecs);
        if (refreshVideo) state.preferredCodec = parsed2.codec;
        forwardToHost(hostMsg, refreshVideo);
      } catch (error) {
        sendJson({ type: "error", message: humanizeError(error), ...errorPayload(error) });
      }
    },
    mouse: forwardControl,
    key: forwardControl,
    text: forwardControl,
    followWindow: forwardControl,
    lockAfterSessionEnd: forwardControl,
    switchDisplay: forwardControl,
    refresh: forwardControl
  };
  const dispatch = (type, message) => handlers[type](message);
  return async (rawData, isBinary) => {
    if (isBinary || state.phase === "closed") return;
    let parsed2;
    try {
      const text = typeof rawData === "string" ? rawData : rawData.toString("utf8");
      parsed2 = JSON.parse(text);
      if (!parsed2 || typeof parsed2 !== "object" || typeof parsed2.type !== "string") {
        throw new Error("missing type field");
      }
    } catch (err) {
      const failure = new AppError("INVALID_REQUEST", "input", "Invalid client message");
      sendJson({ type: "error", message: failure.message, ...errorPayload(failure) });
      return;
    }
    if (parsed2.type !== "ping" && parsed2.type !== "disconnect" && parsed2.type !== "connect") {
      if (state.phase === "awaiting-connect") {
        sendJson({ type: "error", message: "send a connect message first" });
        return;
      }
      if (state.phase !== "live" || !state.hostConn) return;
    }
    if (!Object.hasOwn(handlers, parsed2.type)) return;
    return dispatch(parsed2.type, parsed2);
  };
}

// shared/clipboard.ts
import { decompress } from "fzstd";

// shared/compression.ts
function zstdFrameSize(data, maxBytes) {
  if (data.length < 6 || data[0] !== 40 || data[1] !== 181 || data[2] !== 47 || data[3] !== 253) return null;
  const flag = data[4];
  if (flag & 8) return null;
  const single = flag >> 5 & 1;
  const dict = flag & 3;
  const sizeFlag = flag >> 6;
  const sizeBytes = sizeFlag ? 2 ** sizeFlag : single;
  if (!sizeBytes) return null;
  let offset = 6 - single + (dict === 3 ? 4 : dict);
  if (offset + sizeBytes > data.length) return null;
  let size = sizeFlag === 1 ? 256 : 0;
  for (let i = 0; i < sizeBytes; i++) size += data[offset++] * 2 ** (8 * i);
  if (!Number.isSafeInteger(size) || size > maxBytes) return null;
  let last = false;
  while (!last) {
    if (offset + 3 > data.length) return null;
    const header = data[offset] | data[offset + 1] << 8 | data[offset + 2] << 16;
    offset += 3;
    last = Boolean(header & 1);
    const type = header >> 1 & 3;
    if (type === 3) return null;
    offset += type === 1 ? 1 : header >> 3;
    if (offset > data.length) return null;
  }
  if (flag & 4) offset += 4;
  return offset === data.length ? size : null;
}

// shared/clipboard.ts
var MAX_CLIPBOARD_BYTES = 256 * 1024;
function decodeClipboard(clip) {
  if (!clip?.content || Number(clip.format ?? 0) !== 0 || clip.content.byteLength > MAX_CLIPBOARD_BYTES) return null;
  try {
    let bytes = clip.content;
    if (clip.compress) {
      const size = zstdFrameSize(bytes, MAX_CLIPBOARD_BYTES);
      if (size === null) return null;
      bytes = decompress(bytes, new Uint8Array(size));
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

// server/cursor.ts
import { zstdDecompressSync } from "node:zlib";

// shared/cursor.ts
import { Buffer as Buffer5 } from "buffer";
import { decompress as decompress2 } from "fzstd";
var MAX_CURSOR_SIDE = 512;
var MAX_CURSOR_CACHE_ENTRIES = 16;
var MAX_CURSOR_CACHE_BYTES = 4 * 1024 * 1024;
var CursorShapes = class {
  constructor(decodePixels = (data, expectedBytes) => decompress2(data, new Uint8Array(expectedBytes))) {
    this.decodePixels = decodePixels;
    this.cache = /* @__PURE__ */ new Map();
    this.cacheBytes = 0;
  }
  get(id) {
    return this.cache.get(id) ?? null;
  }
  decode(data) {
    const { id = "0", width = 0, height = 0, hotx = 0, hoty = 0, colors } = data;
    this.remove(id);
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || width > MAX_CURSOR_SIDE || height < 1 || height > MAX_CURSOR_SIDE || !colors?.byteLength || colors.byteLength > 1024 * 1024) {
      return null;
    }
    const expectedBytes = width * height * 4;
    if (zstdFrameSize(colors, expectedBytes) !== expectedBytes) return null;
    let rgba;
    try {
      rgba = Buffer5.from(this.decodePixels(colors, expectedBytes));
    } catch {
      return null;
    }
    if (rgba.byteLength !== expectedBytes) return null;
    const shape = {
      width,
      height,
      hotX: Math.max(0, Math.min(width - 1, hotx)),
      hotY: Math.max(0, Math.min(height - 1, hoty)),
      rgba: rgba.toString("base64")
    };
    for (const key of this.cache.keys()) {
      if (this.cache.size < MAX_CURSOR_CACHE_ENTRIES && this.cacheBytes + shape.rgba.length <= MAX_CURSOR_CACHE_BYTES) break;
      this.remove(key);
    }
    this.cache.set(id, shape);
    this.cacheBytes += shape.rgba.length;
    return shape;
  }
  remove(id) {
    const previous = this.cache.get(id);
    if (previous) {
      this.cacheBytes -= previous.rgba.length;
      this.cache.delete(id);
    }
  }
};

// server/cursor.ts
var CursorShapes2 = class extends CursorShapes {
  constructor() {
    super((data, maxOutputLength) => zstdDecompressSync(data, { maxOutputLength }));
  }
};

// server/hostMessages.ts
async function startHostPump(conn, context, handleVideoFrame) {
  const { state, ws, sendJson, cleanup } = context;
  const publishResolutions = (display, supported) => {
    state.resolutionDisplay = display;
    state.sizes = supportedResolutions(supported);
    sendJson({ type: "resolutions", display, sizes: state.sizes });
  };
  const cursorShapes = new CursorShapes2();
  state.currentSize = initialDisplaySize(conn.peerInfo);
  sendJson(peerToJson(conn.peerInfo, conn));
  publishResolutions(Number(conn.peerInfo.current_display ?? 0), conn.peerInfo.resolutions);
  sendJson({
    type: "status",
    state: "live",
    detail: conn.encrypted ? "encrypted" : "direct",
    username: conn.username
  });
  try {
    while (state.phase === "live") {
      const raw = await conn.stream.next();
      if (!raw) {
        if (state.phase === "live") {
          throw new Error("host closed the connection");
        }
        break;
      }
      const msg = decodeMessage(raw);
      if (msg.test_delay && !msg.test_delay.from_client) {
        void conn.stream.sendRaw(encodeMessage({ test_delay: msg.test_delay })).catch(() => {
        });
        const lastDelay = Number(msg.test_delay.last_delay ?? 0);
        if (lastDelay > 0) {
          sendJson({ type: "rtt", ms: lastDelay });
        }
      }
      if (msg.misc) {
        if (Number.isInteger(msg.misc.follow_current_display)) {
          sendJson({ type: "focusedDisplay", display: msg.misc.follow_current_display });
        }
        if (msg.misc.switch_display) {
          const sd = msg.misc.switch_display;
          const w = Number(sd.width ?? 0);
          const h = Number(sd.height ?? 0);
          if (w > 0 && h > 0) {
            state.currentSize = { width: w, height: h };
          }
          sendJson({
            type: "display",
            display: Number(sd.display ?? 0),
            width: w,
            height: h,
            x: Number(sd.x ?? 0),
            y: Number(sd.y ?? 0),
            cursorEmbedded: Boolean(sd.cursor_embedded),
            name: ""
          });
          publishResolutions(Number(sd.display ?? 0), sd.resolutions);
        }
        if (msg.misc.close_reason) {
          const reason = String(msg.misc.close_reason);
          sendJson({ type: "status", state: "error", ...errorPayload(reason) });
          cleanup(false);
          return;
        }
      }
      const permission = msg.misc?.permission_info;
      if (permission?.permission === HostPermission.PrivacyMode || permission?.permission === HostPermission.Clipboard) {
        if (permission.permission === HostPermission.PrivacyMode) conn.privacyAllowed = permission.enabled === true;
        else conn.clipboardAllowed = permission.enabled === true;
        sendJson({ type: "permissions", ...permissions(conn) });
      }
      const notice = msg.misc?.back_notification;
      if (typeof notice?.privacy_mode_state === "number") {
        const code = notice.privacy_mode_state;
        if (code === PrivacyState.Enabled) state.privacyImpl = notice.impl_key || "";
        if (code === PrivacyState.Unsupported) {
          conn.privacyAllowed = false;
          sendJson({ type: "permissions", ...permissions(conn) });
        }
        sendJson({ type: "privacyResult", ...privacyResult(code) });
      }
      if (permission?.permission === HostPermission.Restart) {
        conn.restartAllowed = permission.enabled === true;
        sendJson({ type: "restartPermission", allowed: canRestart(conn) });
      }
      if (permission?.permission === HostPermission.Audio) {
        state.audioAllowed = permission.enabled === true;
        if (!state.audioAllowed && state.audioRequested) {
          state.audioRequested = false;
          sendJson({ type: "audioDenied" });
        }
      }
      if (msg.misc?.audio_format) {
        const { sample_rate: sampleRate, channels } = msg.misc.audio_format;
        state.audioFormat = typeof sampleRate === "number" && typeof channels === "number" ? { sampleRate, channels } : null;
        if (state.audioRequested && state.audioAllowed && state.audioFormat) sendJson({ type: "audioFormat", ...state.audioFormat });
      }
      const packet = msg.audio_frame?.data;
      if (state.audioAllowed && state.audioRequested && packet && packet.length > 0 && packet.length <= 8192 && ws.bufferedAmount < 262144) {
        sendJson({ type: "audioFrame", packet: Buffer.from(packet).toString("base64") });
      }
      if (conn.clipboardAllowed) {
        const clips = msg.clipboard ? [msg.clipboard] : msg.multi_clipboards?.clipboards ?? [];
        for (const clip of clips) {
          const text = decodeClipboard(clip);
          if (text !== null) {
            sendJson({ type: "clipboard", text });
            break;
          }
        }
      }
      if (msg.cursor_data) {
        sendJson({ type: "cursorShape", shape: cursorShapes.decode(msg.cursor_data) });
      } else if (msg.cursor_id !== void 0) {
        sendJson({ type: "cursorShape", shape: cursorShapes.get(msg.cursor_id) });
      } else if (msg.cursor_position) {
        sendJson({
          type: "cursor",
          x: Number(msg.cursor_position.x ?? 0),
          y: Number(msg.cursor_position.y ?? 0)
        });
      }
      if (msg.peer_info) {
        const updatedSize = initialDisplaySize(msg.peer_info);
        if (updatedSize.width > 0 && updatedSize.height > 0) {
          state.currentSize = updatedSize;
        }
        sendJson(peerToJson(msg.peer_info, conn));
        publishResolutions(Number(msg.peer_info.current_display ?? 0), msg.peer_info.resolutions);
      }
      if (msg.video_frame) {
        handleVideoFrame(conn, msg.video_frame);
      }
    }
  } catch (err) {
    if (state.phase === "live") {
      sendJson({ type: "status", state: "error", ...errorPayload(err) });
      cleanup(false);
    }
  }
}

// server/videoBuffer.ts
var VIDEO_QUEUE_LIMIT_BYTES = 1024 * 1024;
var VIDEO_RESUME_BYTES = 256 * 1024;
var REFRESH_INTERVAL_MS = 1e3;
var GatewayVideoBuffer = class {
  constructor() {
    this.waitingForKey = /* @__PURE__ */ new Set();
    this.refreshPending = false;
    this.lastRefreshAt = -Infinity;
    this.droppedFrames = 0;
  }
  get recovering() {
    return this.waitingForKey.size > 0;
  }
  get needsRefresh() {
    return this.refreshPending && this.recovering;
  }
  shouldForward(display, key, frameBytes, queuedBytes) {
    const waiting = this.waitingForKey.has(display);
    const full = queuedBytes > 0 && queuedBytes + frameBytes > VIDEO_QUEUE_LIMIT_BYTES;
    if (full || waiting && (!key || queuedBytes > VIDEO_RESUME_BYTES)) {
      this.waitingForKey.add(display);
      this.refreshPending = true;
      this.droppedFrames++;
      return false;
    }
    if (waiting) {
      this.waitingForKey.delete(display);
      if (!this.recovering) this.refreshPending = false;
    }
    return true;
  }
  shouldRequestRefresh(queuedBytes, now) {
    if (!this.needsRefresh || queuedBytes > VIDEO_RESUME_BYTES || now - this.lastRefreshAt < REFRESH_INTERVAL_MS) return false;
    this.refreshPending = false;
    this.lastRefreshAt = now;
    return true;
  }
};

// shared/video.ts
import { Buffer as Buffer6 } from "buffer";
var HEADER_LEN = 32;
var CODEC_VP8 = 1;
var CODEC_VP9 = 2;
var CODEC_H264 = 3;
var CODEC_H265 = 4;
var CODEC_AV1 = 5;
var MAGIC_0 = 82;
var MAGIC_1 = 68;
var MAGIC_2 = 86;
var MAGIC_3 = 49;
function encodeRdv1Frame(packet) {
  const out = Buffer6.allocUnsafe(HEADER_LEN + packet.data.byteLength);
  out[0] = MAGIC_0;
  out[1] = MAGIC_1;
  out[2] = MAGIC_2;
  out[3] = MAGIC_3;
  out[4] = packet.codec & 255;
  out[5] = packet.key ? 1 : 0;
  out.writeUInt16LE(packet.display & 65535, 6);
  out.writeUInt32LE(packet.width >>> 0, 8);
  out.writeUInt32LE(packet.height >>> 0, 12);
  out.writeBigInt64LE(packet.pts, 16);
  out.writeBigUInt64LE(packet.gatewayUnixMs, 24);
  Buffer6.from(packet.data.buffer, packet.data.byteOffset, packet.data.byteLength).copy(
    out,
    HEADER_LEN
  );
  return out;
}
function vp8KeyframeSize(data) {
  if (data.byteLength < 10) return null;
  if ((data[0] & 1) !== 0) return null;
  if (data[3] !== 157 || data[4] !== 1 || data[5] !== 42) return null;
  const width = (data[6] | data[7] << 8) & 16383;
  const height = (data[8] | data[9] << 8) & 16383;
  if (width === 0 || height === 0) return null;
  return { width, height };
}
function isH264AnnexBKeyframe(data) {
  const limit = Math.min(data.length, 4096);
  for (let i = 0; i + 4 < limit; i++) {
    if (data[i] === 0 && data[i + 1] === 0) {
      let nalOffset = -1;
      if (data[i + 2] === 1) {
        nalOffset = i + 3;
      } else if (data[i + 2] === 0 && data[i + 3] === 1) {
        nalOffset = i + 4;
      }
      if (nalOffset !== -1 && nalOffset < data.length) {
        const nalType = data[nalOffset] & 31;
        if (nalType === 5 || nalType === 7) return true;
      }
    }
  }
  return false;
}
function isVp9Keyframe(data) {
  if (data.length < 4) return false;
  const b0 = data[0];
  if (b0 >> 6 !== 2) return false;
  const profileLow = b0 >> 5 & 1;
  const profileHigh = b0 >> 4 & 1;
  const profile = profileHigh << 1 | profileLow;
  if (profile < 3) {
    if ((b0 & 8) !== 0 || (b0 & 4) !== 0) return false;
    return data[1] === 73 && data[2] === 131 && data[3] === 66;
  }
  return false;
}
function extractEncodedFrames(vf) {
  if (vf.vp8s?.frames?.length) return { codec: CODEC_VP8, frames: vf.vp8s.frames };
  if (vf.vp9s?.frames?.length) return { codec: CODEC_VP9, frames: vf.vp9s.frames };
  if (vf.h264s?.frames?.length) return { codec: CODEC_H264, frames: vf.h264s.frames };
  if (vf.h265s?.frames?.length) return { codec: CODEC_H265, frames: vf.h265s.frames };
  if (vf.av1s?.frames?.length) return { codec: CODEC_AV1, frames: vf.av1s.frames };
  return null;
}
function isH265AnnexBKeyframe(data) {
  const limit = Math.min(data.length, 4096);
  for (let offset = 0; offset + 5 < limit; offset++) {
    if (data[offset] !== 0 || data[offset + 1] !== 0) continue;
    const header = data[offset + 2] === 1 ? offset + 3 : data[offset + 2] === 0 && data[offset + 3] === 1 ? offset + 4 : -1;
    if (header < 0 || header + 2 >= data.length) continue;
    if ((data[header] & 128) !== 0 || (data[header + 1] & 7) === 0) continue;
    const type = data[header] >> 1 & 63;
    if (type >= 16 && type <= 21) return true;
  }
  return false;
}
function encodedFrameIsKey(codec, data, declaredKey = false) {
  return Boolean(declaredKey) || codec === CODEC_H264 && isH264AnnexBKeyframe(data) || codec === CODEC_H265 && isH265AnnexBKeyframe(data) || codec === CODEC_VP9 && isVp9Keyframe(data);
}

// server/videoFrames.ts
function createVideoFrameHandler(context) {
  const { state, ws, videoBuffer, sendJson, sendBinary, cleanup } = context;
  let recoveryTimer;
  let warnedRawVideo = false;
  const scheduleVideoRecovery = (conn) => {
    if (recoveryTimer || !videoBuffer.needsRefresh) return;
    recoveryTimer = setTimeout(() => {
      recoveryTimer = void 0;
      if (state.phase !== "live" || state.hostConn !== conn || !videoBuffer.needsRefresh) return;
      if (videoBuffer.shouldRequestRefresh(ws.bufferedAmount, performance.now())) {
        void conn.stream.sendRaw(encodeMessage(buildRefreshVideoMessage())).catch((err) => {
          if (state.phase === "live" && state.hostConn === conn) {
            sendJson({ type: "status", state: "error", ...errorPayload(err) });
            cleanup(false);
          }
        });
      }
      scheduleVideoRecovery(conn);
    }, 250);
    recoveryTimer.unref?.();
  };
  const handleFrame = (conn, vf) => {
    if ((vf.rgb || vf.yuv) && !warnedRawVideo) {
      warnedRawVideo = true;
      sendJson({
        type: "error",
        message: "the host sent uncompressed video; this client only decodes vp8, vp9, h264, h265, and av1"
      });
    }
    const extracted = extractEncodedFrames(vf);
    if (extracted) {
      const display = Math.max(0, Number(vf.display ?? 0));
      const nowMs = BigInt(Date.now());
      for (const f of extracted.frames) {
        const payload = f.data ? new Uint8Array(f.data) : new Uint8Array(0);
        const isKey = encodedFrameIsKey(extracted.codec, payload, f.key);
        if (extracted.codec === CODEC_VP8 && isKey) {
          const parsedSize = vp8KeyframeSize(payload);
          if (parsedSize) {
            state.currentSize = parsedSize;
          }
        }
        if (!videoBuffer.shouldForward(display, isKey, payload.byteLength + HEADER_LEN, ws.bufferedAmount)) {
          scheduleVideoRecovery(conn);
          continue;
        }
        const pts = BigInt(f.pts ?? 0);
        const packet = encodeRdv1Frame({
          codec: extracted.codec,
          key: isKey,
          display,
          width: state.currentSize.width,
          height: state.currentSize.height,
          pts,
          gatewayUnixMs: nowMs,
          data: payload
        });
        sendBinary(packet);
      }
      void conn.stream.sendRaw(encodeMessage(buildVideoReceivedMessage())).catch(() => {
      });
    }
  };
  return { handleFrame, dispose: () => clearTimeout(recoveryTimer) };
}

// server/session.ts
function serveSocket(ws, config) {
  const state = {
    phase: "awaiting-connect",
    resolutionDisplay: 0,
    sizes: [],
    hostConn: null,
    sessionCodecs: void 0,
    preferredCodec: void 0,
    privacyImpl: "",
    audioRequested: false,
    audioAllowed: true,
    audioFormat: null,
    currentSize: { width: 0, height: 0 }
  };
  const connection = new AbortController();
  const connectDeadline = setTimeout(() => {
    cleanup(false);
    ws.terminate();
  }, 15e3);
  connectDeadline.unref();
  const videoBuffer = new GatewayVideoBuffer();
  let isAlive = true;
  const sendJson = (payload) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };
  const sendBinary = (buf) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(buf, { binary: true });
    }
  };
  const heartbeat = setInterval(() => {
    if (state.phase === "closed" || ws.readyState !== ws.OPEN) {
      clearInterval(heartbeat);
      return;
    }
    if (!isAlive) {
      cleanup(false);
      ws.terminate();
      return;
    }
    isAlive = false;
    try {
      ws.ping();
    } catch {
      cleanup(false);
      ws.terminate();
    }
  }, 25e3);
  heartbeat.unref?.();
  ws.on("pong", () => {
    isAlive = true;
  });
  const cleanup = (sendClosedStatus) => {
    if (state.phase === "closed") return;
    state.phase = "closed";
    clearTimeout(connectDeadline);
    connection.abort();
    clearInterval(heartbeat);
    video.dispose();
    if (state.hostConn) {
      state.hostConn.stream.close();
      state.hostConn = null;
    }
    if (sendClosedStatus) {
      sendJson({ type: "status", state: "closed", detail: "disconnected" });
    }
    if (ws.readyState === ws.OPEN) ws.close(1e3);
  };
  const context = { state, ws, videoBuffer, sendJson, sendBinary, cleanup };
  const video = createVideoFrameHandler(context);
  sendJson({ type: "hello", service: "rustdesk-web-gateway" });
  ws.on("message", createClientMessageHandler({
    ...context,
    config,
    connectionSignal: connection.signal,
    clearConnectDeadline: () => clearTimeout(connectDeadline),
    startHostPump: (conn) => startHostPump(conn, context, video.handleFrame)
  }));
  ws.on("close", () => {
    cleanup(false);
  });
  ws.on("error", () => {
    cleanup(false);
  });
  return () => cleanup(false);
}

// server.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = path2.dirname(__filename);
function rejectUpgrade(socket, status) {
  const deadline = setTimeout(() => socket.destroy(), 1e3);
  deadline.unref();
  socket.once("error", () => socket.destroy());
  socket.once("close", () => clearTimeout(deadline));
  socket.end(`HTTP/1.1 ${status}\r
Connection: close\r
Content-Length: 0\r
\r
`, () => socket.destroy());
}
async function startServer() {
  const config = getRuntimeConfig();
  const { host, port, gatewayToken, webRtcEnabled, requireOrigin, clientAddress, requestProtocol } = config;
  const app = express2();
  const httpServer = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: 4 * 1024 * 1024 });
  const admissionLimiter = new GatewayAdmissionLimiter();
  let closeFrontend;
  const shutdown = createGatewayShutdown(httpServer, wss, {
    closeFrontend: () => closeFrontend?.() ?? Promise.resolve(),
    onError: (error) => console.error(redactLog(`Shutdown error: ${error instanceof Error ? error.message : String(error)}`))
  });
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Frame-Options", "SAMEORIGIN");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; media-src 'self' blob:; worker-src 'self' blob:; frame-ancestors 'self'"
    );
    if (shutdown.stopping) {
      res.setHeader("Connection", "close");
      res.setHeader("Cache-Control", "no-store");
      res.status(503).json({ error: "Gateway shutting down" });
      return;
    }
    next();
  });
  const faviconSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#0b6bcb"/><rect x="6" y="8" width="20" height="13" rx="2.5" fill="none" stroke="#ffffff" stroke-width="2.2"/><path d="M12 24h8M16 21v3" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round"/></svg>';
  app.get(["/favicon.ico", "/favicon.svg"], (_req, res) => {
    res.setHeader("Content-Type", "image/svg+xml; charset=utf-8");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(200).send(faviconSvg);
  });
  app.get("/api/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({
      ok: true,
      service: "rustdesk-web-gateway",
      authRequired: gatewayToken.length > 0,
      webRtcEnabled
    });
  });
  wss.on("error", (err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(redactLog(`WebSocketServer error: ${message}`));
  });
  httpServer.on("clientError", (_err, socket) => {
    if (socket.writable) {
      socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
    } else {
      socket.destroy();
    }
  });
  httpServer.on("upgrade", (request, socket, head) => {
    if (shutdown.stopping) {
      rejectUpgrade(socket, "503 Service Unavailable");
      return;
    }
    let pathname = "";
    try {
      const reqUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
      pathname = reqUrl.pathname;
    } catch {
      socket.destroy();
      return;
    }
    const origin = typeof request.headers.origin === "string" ? request.headers.origin : "";
    if (!originAllowed(origin, request.headers.host ?? "", config.allowedOrigins, requireOrigin, {
      protocol: requestProtocol(request.socket.remoteAddress, request.headers),
      allowLoopback: !config.production
    })) {
      socket.destroy();
      return;
    }
    if (pathname !== "/ws" && pathname !== "/ws/webrtc") {
      socket.destroy();
      return;
    }
    if (pathname === "/ws/webrtc" && !webRtcEnabled) {
      rejectUpgrade(socket, "403 Forbidden");
      return;
    }
    const admission = admissionLimiter.acquire(clientAddress(request.socket.remoteAddress, request.headers));
    if (!admission) {
      rejectUpgrade(socket, "429 Too Many Requests");
      return;
    }
    socket.once("close", admission.release);
    wss.handleUpgrade(request, socket, head, (ws) => {
      const cleanup = pathname === "/ws/webrtc" ? serveWebRtcSignal(ws, gatewayToken, admission) : serveSocket(ws, { token: gatewayToken, admission });
      shutdown.track(ws, cleanup);
    });
  });
  installApiNotFound(app);
  if (!config.production) {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa"
    });
    closeFrontend = () => vite.close();
    app.use(vite.middlewares);
  } else {
    const distDir = path2.resolve(__dirname, "dist");
    serveProductionFiles(app, distDir);
  }
  const stop = () => {
    void shutdown.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  httpServer.listen(port, host, () => {
    console.log(redactLog(`RustDesk Web Gateway listening on http://${host}:${port}`));
  });
}
startServer().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(redactLog(`Failed to start server: ${message}`));
  process.exit(1);
});
