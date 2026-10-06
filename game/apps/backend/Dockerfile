# Build from the repository root: docker build -f game/apps/backend/Dockerfile .
FROM node:26.9.0-bookworm-slim AS build
WORKDIR /app/game
COPY game/package.json game/yarn.lock ./
COPY game/apps/web/package.json apps/web/package.json
COPY game/apps/backend/package.json apps/backend/package.json
# The workspace resolution is file:apps/web/vendor/solana-buffer-layout-utils,
# i.e. the vendored backport lives INSIDE the game/apps/web project tree. That
# keeps the file: dependency above no project root, so the same tree installs
# wherever only one directory is visible (Cloudflare Pages Root directory).
COPY game/apps/web/vendor/solana-buffer-layout-utils apps/web/vendor/solana-buffer-layout-utils
RUN yarn install --frozen-lockfile --non-interactive
COPY game/apps/backend/tsconfig.json apps/backend/tsconfig.json
COPY game/apps/backend/src apps/backend/src
# Миграции копируются в образ: их применяет точка входа dist/db-migrate.js
# (docker-compose: сервис migrate до старта backend), чтобы деплой не зависел от
# tsx/dev-зависимостей на хосте.
COPY game/migrations /app/migrations
RUN yarn workspace backend build

FROM node:26.9.0-bookworm-slim AS runtime
WORKDIR /app/game
ENV NODE_ENV=production
# Keep the same workspace graph/lockfile for runtime dependency resolution.
COPY game/package.json game/yarn.lock ./
COPY game/apps/web/package.json apps/web/package.json
COPY game/apps/backend/package.json apps/backend/package.json
COPY game/apps/web/vendor/solana-buffer-layout-utils apps/web/vendor/solana-buffer-layout-utils
RUN yarn install --frozen-lockfile --non-interactive --production=true && yarn cache clean
COPY --from=build /app/game/apps/backend/dist apps/backend/dist
COPY --from=build /app/migrations /app/migrations
USER node
EXPOSE 8080
# F-20: liveness probe on the documented /live endpoint (OPERATIONS.md health
# semantics). PORT defaults to 8080 (env.ts); readiness/health stay process-
# internal — orchestrator hits /live here.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e 'fetch(`http://127.0.0.1:${process.env.PORT||8080}/live`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'

CMD ["node", "apps/backend/dist/index.js"]
