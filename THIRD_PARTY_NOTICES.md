# Third-party notices

The web client and gateway are AGPL-3.0-only. The packages below are direct dependencies used to build or run that code. Versions match the lockfile used in this tree. Their licenses are the ones declared in each package's `package.json`. Transitive dependencies remain under their own notices inside `node_modules` after install.

| Package | Version | License |
|---|---|---|
| react | 19.3.1 | MIT |
| react-dom | 19.3.1 | MIT |
| lucide-react | 0.546.0 | ISC |
| express | 4.22.3 | MIT |
| ws | 8.23.0 | MIT |
| dotenv | 17.2.3 | BSD-2-Clause |
| buffer | 6.0.3 | MIT |
| tweetnacl | 1.0.3 | Unlicense |
| @noble/hashes | 2.4.0 | MIT |
| fzstd | 0.1.1 | MIT |
| protobufjs | 8.8.1 | BSD-3-Clause |
| vite | 8.3.8 | MIT |
| typescript | 7.0.2 | Apache-2.0 |
| tailwindcss | 4.3.5 | MIT |
| esbuild | 0.25.12 | MIT |
| tsx | 4.23.15 | MIT |

The container image is based on the official `node:24-bookworm-slim` image under its Debian and Node.js licenses.

RustDesk protocol names and message shapes follow the RustDesk project, which is AGPL-3.0. This repository does not copy that project's git history.
