# Deployment

This stack is an alpha build for a controlled test. It is not a public release. Do not expose it on the internet. The release gate in the project changelog is not met: there is no real-device proof, and this repository does not publish images, packages, or git tags.

The container runs as the unprivileged user `web` (uid 10001), listens on port 3000 inside the container, and exits in production unless `RUSTDESK_GATEWAY_TOKEN` is a real value. The token is injected at runtime. It is not copied into the image.

## Install

Requirements: Docker Engine 24 or newer, the Docker Compose plugin, and Node.js 24 only if you build outside Docker. The image itself uses Node.js 24.22.3.

From the repository root:

```sh
deploy/deploy.sh --bind 127.0.0.1 --port 21120 --token "$(openssl rand -hex 32)"
```

The script writes `deploy/.env.docker` with mode `0600` and starts Compose. Open `http://127.0.0.1:21120`. The page and `/api/health` come from the same container. WebSocket traffic uses `/ws`.

Plain HTTP is only for a local test. A browser will not decode remote video on a non-localhost origin without HTTPS.

## HTTPS and WebSocket

Put certificates at `deploy/nginx/certs/fullchain.pem` and `deploy/nginx/certs/privkey.pem`. Those files are gitignored.

```sh
docker compose --env-file deploy/.env.docker -f deploy/docker-compose.yml --profile https up -d
```

Nginx terminates TLS, forwards `/` to the app, and upgrades `/ws` to WebSocket. The public origin must match the `Host` name, or be listed in `RUSTDESK_ALLOWED_ORIGINS`, or the gateway closes the socket.

On the machine that built this image, `http://127.0.0.1:21120/api/health` returned the gateway JSON and a WebSocket upgrade on `/ws` returned `101 Switching Protocols`. Nginx started, resolved the app container, and then timed out opening a TCP connection across the Docker bridge (`504`). That bridge path was not proven here. The published port was.

## Browser WebRTC

The gateway uses WebSocket remote sessions by default. Set `RUSTDESK_ENABLE_WEBRTC=true` in the gateway's environment to advertise the optional browser transport over `/api/health`. Use a compatible RustDesk host and ID server configured for WebRTC, and serve the browser over HTTPS or localhost. The signaling endpoint uses the same gateway token and origin checks as `/ws`.

Device-ID sessions can negotiate WebRTC. IP connections, forced relay, unsupported browsers, and failures before peer authentication use the regular gateway route. The browser checks the ID-server signature, peer identity, and signed DTLS fingerprint before submitting the remote password. Login failures after that point stay on the original attempt.

Check the connection details to distinguish browser-direct, TURN relay, and gateway routes. The [reference ID-server compatibility notes](https://github.com/suijiafeng/rustdesk/blob/4325cb196ea690cef1a8898711a1512818bcb7d0/web-client/server-patches/hbbs/README.md) explain which hbbs configurations can forward the required signaling.

## Logs

Compose keeps json-file logs at 10 MB times 3 files. The process redacts `token` and `password` values before writing an error line. Do not enable a logging driver that stores the environment block.

## Limits

The app container is limited to 1 CPU and 512 MB. Nginx, when enabled, is limited to 0.5 CPU and 128 MB. The app restarts unless it was stopped on purpose.

## Upgrade

1. Fetch the commit you intend to run. Do not create a release tag for this alpha.
2. Rebuild: `docker compose --env-file deploy/.env.docker -f deploy/docker-compose.yml up -d --build`.
3. Check `http://127.0.0.1:<port>/api/health`.

The image name `rustdesk-web-client:local` is only on this machine.

## Rollback

1. Check out the previous known commit. Do not rely on a published image, because none is published.
2. Run the same Compose command. Docker rebuilds `rustdesk-web-client:local` from that commit.
3. If the new container is unhealthy, `docker compose -f deploy/docker-compose.yml logs rustdesk-web` and then rebuild the older commit again.

`deploy/.env.docker` is left in place, so the token does not have to be pasted into the shell history a second time.

## Troubleshooting

| Symptom | What to check |
|---|---|
| Container exits immediately | Production mode without a real token. `docker logs` should say to set `RUSTDESK_GATEWAY_TOKEN`. |
| Host port busy, or 21114–21119 | Those ports belong to RustDesk hbbs/hbbr. `deploy.sh` moves to the next free port. |
| Browser shows the page but no video | WebCodecs needs localhost or HTTPS. Use the nginx profile. |
| WebSocket closes at once | Origin is not the request host, not loopback, and not in `RUSTDESK_ALLOWED_ORIGINS`. |
| Connect form says the target is not allowed | The address is empty, contains credentials, or is a cloud metadata host. |
| Health stays red | `docker logs rustdesk-web-client` and `docker inspect --format '{{json .State.Health}}' rustdesk-web-client`. |

## What this environment did not prove

A fresh container build is only a local Docker build. It does not prove a remote desktop session. Do not treat a healthy `/api/health` response as a working remote-control deployment.
