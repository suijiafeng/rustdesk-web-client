# Node 24 matches .nvmrc. The runtime image does not contain source, dev tools, or secrets.
FROM node:24.22.3-bookworm-slim AS build

WORKDIR /src
COPY package.json yarn.lock ./
COPY apps ./apps
COPY packages ./packages
COPY tsconfig.json tsconfig.base.json ./

RUN corepack enable && corepack prepare yarn@1.22.22 --activate \
  && yarn install --frozen-lockfile \
  && yarn build \
  && yarn install --frozen-lockfile --production --ignore-scripts

FROM node:24.22.3-bookworm-slim AS runtime

RUN apt-get update \
  && apt-get install -y --no-install-recommends tini ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system --gid 10001 web \
  && useradd --system --uid 10001 --gid web --home-dir /app --shell /usr/sbin/nologin web

WORKDIR /app
COPY --from=build --chown=web:web /src/node_modules ./node_modules
COPY --from=build --chown=web:web /src/apps/gateway/dist ./gateway
COPY --from=build --chown=web:web /src/apps/web/dist ./web
COPY --from=build --chown=web:web /src/package.json ./package.json

USER web
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    WEB_ROOT=/app/web
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["tini", "-s", "--"]
CMD ["node", "gateway/index.js"]
