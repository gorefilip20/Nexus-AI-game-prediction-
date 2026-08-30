# Deploying NexusBet AI

## What this app is, architecturally

Two pieces with different hosting needs:

| Piece | Nature | Hosting |
| --- | --- | --- |
| `client/` | Static bundle after build | Any CDN or static host |
| `server/` | **Long-lived Node process** — holds WebSocket connections, an in-memory cache and fitted models, and runs a settlement timer | A real server or container |

The backend is **stateful and long-lived**. That single fact decides which
platforms work.

## Platform notes

### Netlify — frontend only

Netlify hosts the client perfectly. It **cannot host this backend**. Netlify's
compute is serverless functions: no long-lived process, so a WebSocket cannot
stay open, the TTL cache and fitted models are lost between invocations, and the
settlement timer never fires. Every request would refit models from scratch and
burn the provider quota.

Use Netlify for the client, point it at a backend hosted elsewhere:

```toml
# netlify.toml
[build]
  command = "npm ci && npm run build"
  publish = "client/dist"

[[redirects]]
  from = "/api/*"
  to = "https://api.your-domain.com/api/:splat"
  status = 200
  force = true

# SPA fallback — must come last.
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

WebSockets cannot be proxied through Netlify redirects. Set `VITE_WS_URL` to the
backend's absolute `wss://` URL at build time.

### DigitalOcean App Platform — simplest full-stack option

Runs the container directly, restarts on crash, terminates TLS.

1. Point it at the repo; it detects the `Dockerfile`.
2. Set `HTTP Port` to `5000` and the health check path to `/api/health`.
3. Add environment variables, marking secrets **SECRET** (encrypted at rest):
   `API_SPORTS_KEY`, `CORS_ORIGIN`, `NODE_ENV=production`, `TRUST_PROXY=true`,
   `SERVE_CLIENT=true`.
4. Attach a volume mounted at `/data` and set `LEDGER_PATH=/data/ledger.json`.
   **Without this the ledger resets on every deploy** and the tracker silently
   loses its settled history.

Crash recovery is built in: a container exiting non-zero is restarted, and a
failing health check pulls the instance out of rotation.

### AWS

**ECS Fargate** is the closest fit. Task definition essentials:

- `essential: true` so a container exit restarts the task.
- Health check `CMD-SHELL` against `/api/health`.
- ALB target group with a sticky session cookie — the WebSocket must return to
  the instance holding it.
- `API_SPORTS_KEY` from Secrets Manager via `secrets`, never `environment`.
- EFS mounted at `/data` for the ledger.
- `TRUST_PROXY=true` so the ALB's `X-Forwarded-For` is honoured.

**EC2** works too: run the container, or use PM2 (`ecosystem.config.cjs`).

**Lambda / API Gateway will not work** for the same reason as Netlify.

### Any Docker host

```bash
cp .env.example .env      # fill in secrets
docker compose up -d --build
docker compose logs -f
```

`restart: unless-stopped` plus the healthcheck gives crash recovery. The
`ledger-data` volume keeps settled picks across redeploys.

## Crash recovery, by layer

| Layer | Mechanism |
| --- | --- |
| Process | `unhandledRejection` and `uncaughtException` log fatally and exit non-zero, so the supervisor restarts from a known state rather than continuing from an unknown one |
| Signals | `SIGTERM`/`SIGINT` drain in-flight requests, stop the settlement timer and close sockets before exit; `dumb-init` is PID 1 so signals actually reach Node |
| Container | `restart: unless-stopped` + `HEALTHCHECK` |
| VM | PM2 `autorestart` with `min_uptime`/`max_restarts` so a genuine crash loop stops instead of thrashing, and exponential backoff between attempts |
| Provider outage | Not a crash: the TTL cache serves the last good value, and one failing sport degrades to a note rather than emptying the board |

## Persistence

The ledger is a JSON file at `LEDGER_PATH`. That is fine for one instance with a
mounted volume, and **not** fine for horizontal scaling.

Moving it to a database is the prerequisite for running more than one instance.
`DATABASE_URL` is reserved in `.env.example` for that; nothing reads it yet.

## Scaling beyond one instance

Three things are per-process memory today:

1. **The punter lounge** — each instance has its own room, so users on different
   instances cannot see each other.
2. **The TTL cache** — each instance keeps its own, multiplying provider
   requests by the instance count against a 100/day free-tier quota.
3. **The fitted models** — refit per instance.

So: **run one instance** until a shared bus (Redis pub/sub for the lounge and
cache) and a database for the ledger are in place. Use sticky sessions if a load
balancer sits in front regardless, so a WebSocket returns to its own instance.

Vertical scaling is the near-term answer. The workload is small: the heaviest
operation is fitting a league model, which is a few hundred milliseconds.

## Pre-deploy checklist

```bash
npm ci
npm test                 # 149 tests
npm run check:secrets    # blocks on a tracked or bundle-exposed credential
npm run build            # client bundle into client/dist
npm run verify:provider  # confirms the live feed with your key
```

Then confirm:

- [ ] `NODE_ENV=production`
- [ ] `CORS_ORIGIN` is your real origin, not `*` — the server refuses to boot otherwise
- [ ] `API_SPORTS_KEY` set from a secret store, not a committed file
- [ ] `TRUST_PROXY=true` behind a load balancer
- [ ] `LEDGER_PATH` points at a mounted volume
- [ ] No `VITE_`-prefixed secret anywhere — it would be served to every visitor

The server validates all of this at boot and **refuses to start** on a fatal
misconfiguration, so a bad deploy fails immediately and visibly rather than
serving sample data to real users.

## Build output

```
dist/index.html                    0.82 kB │ gzip:  0.43 kB
dist/assets/index-*.css           23.97 kB │ gzip:  5.45 kB
dist/assets/rolldown-runtime-*.js  0.58 kB │ gzip:  0.36 kB
dist/assets/vendor-icons-*.js     12.45 kB │ gzip:  5.06 kB
dist/assets/index-*.js            37.94 kB │ gzip: 10.31 kB
dist/assets/vendor-react-*.js    182.12 kB │ gzip: 57.30 kB
```

React and the icon set are split into their own chunks. They change only on
upgrade, so a routine deploy invalidates the 10 kB app chunk instead of forcing
every returning visitor to re-download all 72 kB.

Responses are Brotli-compressed above 1 kB: the prediction board goes out at
about 1.1 kB on the wire against 7.8 kB uncompressed.

There are **no image assets** — every icon is an inline SVG from `lucide-react`,
so there is nothing to compress and no image pipeline to configure. If you add
images later, put them in `client/public/` and add a compression plugin then.
