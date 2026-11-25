FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global --force yarn@1.22.22
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --non-interactive
COPY . .
RUN yarn build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
RUN npm install --global --force yarn@1.22.22
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile --production=true --non-interactive && yarn cache clean
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
