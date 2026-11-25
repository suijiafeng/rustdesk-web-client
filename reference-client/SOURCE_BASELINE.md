# Reference implementation baseline

Source: [suijiafeng/rustdesk, feature/web-client, fixed commit 4325cb1](https://github.com/suijiafeng/rustdesk/tree/4325cb196ea690cef1a8898711a1512818bcb7d0/web-client). Only that commit's tracked `web-client/` subtree is imported. The native Rust/Flutter clients and original Git history are not imported. See the repository license and third-party notices. Existing workspaces and their deployment path are unchanged.

`src/`, `server/`, `shared/`, `server-patches/`, `index.html`, toolchain configuration and `yarn.lock` are copied without changes. The standalone adjustments are package metadata and documentation, a loopback default and required token for production/non-loopback use, and private local Docker defaults. The inherited hbbs patches are informational and optional; nothing applies them.

No public deployment is approved by this import. A browser UI check against simulated session messages does not validate WebSocket-to-host connectivity, actual media or input, device behavior, or the WebRTC route. Before adopting the candidate, run both implementations against the same owned Mac over a trusted private network, initially through the default WebSocket route.

## Candidate verification

- The built front-end assets were byte-identical to the reference build. Frozen install, typechecking, 111 tests, and production build passed.
- Both Node gateways started simultaneously on separate loopback ports and reported healthy with a private test token and WebRTC off. Candidate startup rejected a missing token in production and a non-loopback development bind without a token.
- The same simulated Chromium session was used for both: collapsed handle, floating toolbar, desktop menu, connection management, and mobile display and action menus rendered pixel-identically on the test viewports. Both sent normal keystrokes in the session, no keystrokes while interacting with local menus or connection management, and did not disconnect when returning.
- Real video, end-to-end encoding and input, actual phone IME, clipboard and audio, Docker runtime, and real WebRTC were not exercised.
