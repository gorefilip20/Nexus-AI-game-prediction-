# syntax=docker/dockerfile:1

# =============================================================================
# Stage 1 — build the client bundle
# =============================================================================
FROM node:22-alpine AS build

WORKDIR /app

# Copy manifests first so the dependency layer is cached across source changes.
COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/

RUN npm ci

COPY . .
RUN npm run build --workspace client

# =============================================================================
# Stage 2 — production dependencies only
# =============================================================================
FROM node:22-alpine AS deps

WORKDIR /app

COPY package.json package-lock.json ./
COPY client/package.json ./client/
COPY server/package.json ./server/

# --omit=dev drops Vite, Tailwind and the test tooling: they are build-time only.
RUN npm ci --omit=dev && npm cache clean --force

# =============================================================================
# Stage 3 — runtime
# =============================================================================
FROM node:22-alpine AS runtime

# dumb-init is PID 1 so SIGTERM reaches Node directly. Without it, Node runs as
# PID 1, does not get default signal handlers, and the platform's graceful-stop
# signal is ignored until it escalates to SIGKILL.
RUN apk add --no-cache dumb-init

ENV NODE_ENV=production \
    PORT=5000 \
    HOST=0.0.0.0 \
    SERVE_CLIENT=true \
    LEDGER_PATH=/data/ledger.json

WORKDIR /app

COPY --from=deps  /app/node_modules   ./node_modules
COPY --from=build /app/client/dist    ./client/dist
COPY server/                          ./server/
COPY package.json                     ./

# The ledger is the only writable path; everything else stays read-only.
# `node` (uid 1000) ships with the base image — no user creation needed.
RUN mkdir -p /data && chown -R node:node /data

USER node
VOLUME ["/data"]
EXPOSE 5000

# Compose and orchestrators read this to decide whether to restart the container.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "server/src/server.js"]
