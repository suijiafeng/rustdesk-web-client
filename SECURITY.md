# Security

Report a vulnerability privately to suijiafeng@hotmail.com. Do not open a public issue for an unfixed security bug.

The gateway is a proxy to a RustDesk host. In production it refuses to start until `RUSTDESK_GATEWAY_TOKEN` is set. Browser WebSocket connections must come from the same host, from loopback during development, or from `RUSTDESK_ALLOWED_ORIGINS`. Direct and ID-server targets cannot be the cloud metadata addresses `169.254.169.254` or `metadata.google.internal`.

Passwords and gateway tokens are not written to device storage or diagnostic exports. View-only mode blocks keyboard, pointer, wheel, and touch input. Frame size and video backlog are capped.
