# Architecture

This client is split so the browser never opens a TCP connection to a RustDesk host and never holds the host handshake keys.

```text
Browser (apps/web)
  |  HTTPS or localhost HTTP
  |  WebSocket /ws  and  GET /api/health
  v
Gateway (apps/gateway)
  |  RustDesk TCP, framed messages, optional NaCl
  v
RustDesk host or ID/relay servers
```

## Modules

- `apps/web` draws the session, maps pointer and touch coordinates, and sends keyboard and mouse messages. View-only mode stops those sends in the browser. That check is not the security boundary.
- `apps/gateway` checks the gateway token, rejects a foreign browser `Origin`, refuses metadata targets, and forwards media. In `NODE_ENV=production` it exits when the token is missing or still a placeholder.
- `packages/protocol` encodes frames and protobuf messages. It does not open sockets.
- `packages/shared` is the JSON message contract between the page and the gateway.

## Trust

The gateway is a proxy. Anyone who can open its WebSocket can ask it to dial a host, subject to the token, origin rule, and target filter. Put it behind TLS, set a token, and do not publish it while the release gate is open.

Passwords are used for the host challenge and are not written into device storage or the diagnostic export. The diagnostic export redacts `password` and `token` fields.

The host remains the authority for privacy mode, clipboard, and file transfer. The page displays the flags the gateway reports. A revoked flag is not treated as permission.

## What is not proven

No real controlled device has been attached. Container-to-container TLS proxying timed out on the build machine even though the published port and an in-container health check succeeded. Those limits are repeated in the changelog.
