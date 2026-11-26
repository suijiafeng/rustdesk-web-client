# Contributing

This repository is AGPL-3.0-only. Contributions are accepted under the same license.

Do not send passwords, gateway tokens, host keys, or screenshots that show a real desktop. Do not copy history from `rustdesk/rustdesk`.

## Setup

Use Node.js 24 and Yarn 1.22.22.

```sh
yarn install --frozen-lockfile
yarn typecheck
yarn test
yarn build
```

`yarn dev` starts the web app on http://127.0.0.1:5173 and the gateway on port 3001.

## Commits

Author and committer are the person who wrote the change. Subjects are one English Conventional Commits line, with no body and no `Co-authored-by` trailer. The line should say what the change adds or fixes. Each commit should still typecheck and test.

Do not commit local `.env` or `.env.*` files (except `.env.example`), certificates, `node_modules`, or build output. `docs/migration/` stays untracked.

## Pull requests

Describe the behavior change, the commands you ran, and any security impact. The pull request template asks for those. A green local `yarn test` is not a real-device test. Say so when that is the case.

Do not open a public issue for an unfixed vulnerability. Use the contact in [SECURITY.md](SECURITY.md).
