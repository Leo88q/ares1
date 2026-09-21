# Build from game/: docker build -f apps/backend/Dockerfile .
FROM node:22.22.3-bookworm-slim AS build
WORKDIR /app
COPY package.json yarn.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/backend/package.json apps/backend/package.json
RUN yarn install --frozen-lockfile --non-interactive
COPY apps/backend/tsconfig.json apps/backend/tsconfig.json
COPY apps/backend/src apps/backend/src
RUN yarn workspace backend build

FROM node:22.22.3-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Keep the same workspace graph/lockfile for runtime dependency resolution.
COPY package.json yarn.lock ./
COPY apps/web/package.json apps/web/package.json
COPY apps/backend/package.json apps/backend/package.json
RUN yarn install --frozen-lockfile --non-interactive --production=true && yarn cache clean
COPY --from=build /app/apps/backend/dist apps/backend/dist
USER node
EXPOSE 8080
CMD ["node", "apps/backend/dist/index.js"]
