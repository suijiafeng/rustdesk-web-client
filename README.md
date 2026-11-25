# RustDesk Web Client

Unofficial browser client for RustDesk. It is not affiliated with the RustDesk authors.

Copyright (C) 2026 suijiafeng. This program is licensed under the GNU Affero General Public License version 3 only. See [LICENSE](LICENSE).

RustDesk itself is also AGPL-3.0. This repository reimplements a web client and does not copy the upstream application's source history.

Requires Node.js 24 and Yarn 1.22.

```sh
yarn install --frozen-lockfile
yarn dev
```

The web app is at http://127.0.0.1:5173 and proxies `/api` to the gateway on port 3001. Copy `.env.example` to `.env` to override `PORT`.

```sh
yarn typecheck
yarn lint
yarn test
yarn build
yarn start
```

`yarn lint` runs the TypeScript check. `yarn start` serves the built gateway.
