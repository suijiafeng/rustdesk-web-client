# RustDesk Web Client

[中文](README.zh-CN.md) · [Architecture](docs/architecture.md) · [Changelog](CHANGELOG.md)

An unofficial RustDesk client for the browser, built with React and a Node.js gateway.

> **Alpha status:** this project is under controlled development and is not ready for public exposure. It is not affiliated with, endorsed by, or maintained by the RustDesk authors.

The browser renders and decodes the remote session. The gateway opens the RustDesk protocol connection and relays frames, media, input, and session control through WebSocket.

```text
Browser
  | HTTPS or localhost
  | /api/health  /ws  /ws/webrtc
  v
Node.js gateway
  | RustDesk TCP and optional WebRTC signaling
  v
RustDesk host / ID and relay servers
```

## Status

- The project can be installed, typechecked, built, and tested with Node.js 24 and Yarn 1.22.22.
- Automated tests cover protocol, gateway, WebRTC signaling, cursor, and browser-side logic.
- Real-device, Windows, macOS, Linux, Android, iOS, and public-TLS testing is not complete.
- Every compatibility-matrix entry remains `untested` until evidence is recorded.
- WebRTC is disabled by default and requires compatible hbbs/hbbr infrastructure.
- A local Docker Compose deployment is supported, but the project should not be published as a release yet.

See [CHANGELOG.md](CHANGELOG.md) for the release gate and known limits.

## Features

- Browser remote session with WebCodecs video decoding
- Keyboard, pointer, touch, pinch, pan, and remote wheel input
- Mobile toolbar with on-screen keyboard support
- Audio playback and privacy-mode controls when reported by the host
- Multiple monitors and remote resolution selection when supported
- Session diagnostics, RTT information, and quality/frame-rate controls
- Bidirectional plain-text clipboard synchronization
- Gateway token authentication and WebSocket origin filtering
- Optional WebRTC transport with automatic fallback to the gateway path

## Requirements

- Node.js 24 (`.nvmrc` and `.node-version`)
- Yarn Classic 1.22.22
- A browser with WebCodecs support
- HTTPS for remote browser access; `http://localhost` is acceptable for local development
- A RustDesk host that grants the required mouse, keyboard, audio, privacy, and clipboard permissions

## Quick start

From the repository root:

```sh
yarn install --frozen-lockfile
cp .env.example .env
yarn dev
```

Open `http://127.0.0.1:3000`. The development server provides the React page and gateway WebSockets.

The local `.env` file is optional for development. For production, set a real gateway token.

```sh
export RUSTDESK_GATEWAY_TOKEN="$(openssl rand -hex 32)"
yarn typecheck
yarn lint
yarn test
yarn build
NODE_ENV=production yarn start
```

`yarn lint` is an alias-style compatibility command that runs the TypeScript check.

## Environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `NODE_ENV` | development | Set to `production` for the built frontend |
| `HOST` | `127.0.0.1` | Gateway bind address; Render forces `0.0.0.0` |
| `PORT` | `3000` | HTTP and WebSocket listener port |
| `RUSTDESK_GATEWAY_TOKEN` | empty | Private token required for public gateways |
| `RUSTDESK_ALLOWED_ORIGINS` | empty | Comma-separated WebSocket Origin allowlist |
| `RUSTDESK_ENABLE_WEBRTC` | `false` | Set to `true` to enable the optional WebRTC signaling path |

In production, `RUSTDESK_GATEWAY_TOKEN` must be a real value rather than an empty or placeholder token. The gateway token and the RustDesk host password are separate credentials.

The health endpoint is available at `/api/health`:

```json
{
  "ok": true,
  "service": "rustdesk-web-gateway",
  "authRequired": true,
  "webRtcEnabled": false
}
```

## Docker

The compose deployment binds to `127.0.0.1:21120` by default.

```sh
export RUSTDESK_GATEWAY_TOKEN="$(openssl rand -hex 32)"
docker compose up -d --build
curl http://127.0.0.1:21120/api/health
```

You can also use the one-click script:

```sh
./deploy.sh
./deploy.sh --port 28080 --token "$(openssl rand -hex 32)"
```

The script writes `HOST_PORT`, `HOST_BIND`, `CONTAINER_NAME`, and the gateway token to `.env.docker` with mode `600`. Both `.env` and `.env.docker` are ignored by Git.

For remote access, place the gateway behind HTTPS and forward WebSocket upgrades for `/ws` and, when enabled, `/ws/webrtc`. The container health check uses `/api/health`.

## WebRTC

WebRTC is opt-in. When disabled, every session uses the existing gateway path.

Enable it only after preparing both the gateway and signaling infrastructure:

1. Set `RUSTDESK_ENABLE_WEBRTC=true` on the Node.js gateway.
2. Restart the gateway and refresh the page.
3. Configure a compatible RustDesk ID server and hbbs patch where required.
4. Enable the corresponding WebRTC setting on supported hosts.
5. Set the same ID server and public key in **Settings → Network**.
6. Ensure UDP connectivity and host firewall rules allow WebRTC.

The signaling endpoint is `/ws/webrtc`. WebRTC identity is verified using server/device signatures and DTLS fingerprint data. If signaling, networking, or verification fails, the session closes the attempted channel and falls back to the gateway path.

Official open-source hbbs/hbbr builds do not by themselves imply support for this signaling protocol. Use a compatible server or apply [server-patches/hbbs/README.md](server-patches/hbbs/README.md).

## Clipboard and local data

- Clipboard synchronization is enabled per session and supports plain UTF-8 text up to 256 KiB.
- Remote text can only be written locally when the browser grants clipboard permission.
- Clipboard synchronization does not run as a system-wide background service.
- The optional remembered password is AES-256-GCM encrypted and stored per device in this browser’s local storage; the non-exportable key is stored in IndexedDB.
- Device records and display settings use `localStorage`. Legacy plaintext password values are cleared on startup.

Same-origin scripts can access browser storage. Client-side encryption is not a substitute for securing the web origin, browser profile, and hosting environment.

## Mobile

The mobile toolbar can switch between touch and mouse modes, show an on-screen keyboard, adjust screen settings, and open gesture controls.

- One-finger tap sends a touch or mouse action according to the selected mode.
- Drag moves the remote pointer or pans the remote view.
- Two-finger pinch zooms the remote view.
- Three-finger vertical drag sends wheel input.
- Gesture details are available in the **Gestures** menu.

The host operating system may capture multi-finger gestures before the browser receives them.

## Project structure

| Path | Responsibility |
| --- | --- |
| `src/` | React UI, input, gestures, WebCodecs, WebRTC browser client, and local settings |
| `server.ts` | HTTP, health, static frontend, WebSocket upgrade, and server startup |
| `server/` | RustDesk protocol, sessions, media, input, and signaling forwarding |
| `shared/` | Protocol and WebRTC message definitions shared across layers |
| `server-patches/hbbs/` | Optional hbbs signaling adaptation and instructions |
| `docs/` | Architecture notes and screenshots |
| `Dockerfile` | Node.js build and runtime image |
| `docker-compose.yml` | Local container deployment |
| `deploy.sh` | One-click Docker deployment |

Architecture boundaries and trust considerations are documented in [docs/architecture.md](docs/architecture.md).

## Validation

Run the smallest relevant checks during development:

```sh
yarn typecheck
yarn test
yarn build
```

For Docker validation:

```sh
docker compose config
docker compose up -d --build
curl http://127.0.0.1:21120/api/health
```

No real-device remote session should be claimed unless it was performed and recorded with the relevant host platform.

## License

Copyright 2026 suijiafeng. Licensed under GNU AGPL-3.0-only. See [LICENSE](LICENSE).
