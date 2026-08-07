FROM node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS build

WORKDIR /workspace
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json frontend/package.json
COPY backend/package.json backend/package.json
COPY backend backend
RUN pnpm install --frozen-lockfile --filter ./backend...
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm --filter ./backend prisma:generate
RUN pnpm --filter ./backend build
RUN pnpm --filter ./backend deploy --prod --legacy /runtime

FROM node:24-bookworm-slim@sha256:235600a8101ab264e117b1768e925532262668dc9b581ef1dd7d96ced463b8e7 AS runtime

ENV NODE_ENV=production
ENV PORT=4000

WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg openssl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /runtime ./
COPY --from=build --chown=node:node /workspace/backend/dist ./dist

USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
