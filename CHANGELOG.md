# Changelog

## 0.0.0-alpha (unreleased)

This is not `v0.1.0-rc.1` and not `v0.1.0`. No tag, GitHub Release, package, or container image has been published. The build is an alpha for controlled development and is not recommended for public exposure.

The local Docker image `rustdesk-web-client:local` can be built from `deploy/Dockerfile`. That name is not a registry release.

### Release gate

Formal recommendation to users requires every item below. Unchecked items are not done.

- [x] The project installs and builds with Yarn on Node.js 24.
- [x] A Docker image builds locally (`rustdesk-web-client:local`, Node.js 24.22.3).
- [x] Docker Compose serves `/api/health` and the web shell on the published port, and a WebSocket upgrade on `/ws` returned `101`.
- [ ] The optional nginx TLS proxy was not proven. In this environment it resolved the app and then timed out across the Docker bridge (`504`).
- [x] `yarn test` passes for protocol, gateway, and web.
- [ ] Real-device tests for the declared platforms are not done. Every row in the compatibility matrix is `untested`.
- [ ] Gateway authentication and access control have automated checks, not an independent security review.
- [ ] Remote authorization has not been verified against a live host. View-only blocking is implemented in the client.
- [ ] A full review for unresolved high-risk issues has not been done.
- [ ] Unbounded memory growth has not been measured in a long session. Frame size and video backlog have caps.
- [ ] Historical high-priority review comments have not each been re-checked on a live host.
- [x] `LICENSE` and `THIRD_PARTY_NOTICES.md` are present.
- [ ] Install and deploy instructions were exercised for local Compose. The TLS path and a fresh remote server were not.
- [x] Known limits are stated in this file and in the README.
- [x] The project states that it is not affiliated with the RustDesk authors.

### Not in this alpha

- No `v0.1.0-rc.1` candidate.
- No `v0.1.0` public preview.
- No registry push and no npm publish.
- `docs/screenshots/connect-form.png` is the empty local connect form. There is no remote-session recording.
