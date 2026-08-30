# NexusBet AI

Multi-sport analytics dashboard, streak tracker and real-time punter lounge, built
from the *NexusBet AI — Codebase Blueprint*.

> **Demo build.** Every fixture, probability, odds figure, booking code and
> settlement row in this repository is sample data. Nothing here is model output
> or a record of settled wagers, and the app does not connect to any sportsbook.
> See [Sample data and honest framing](#sample-data-and-honest-framing) before
> putting this in front of users.

## Stack

| Layer | Choice |
| --- | --- |
| Front-end | React 19 + Vite, Tailwind CSS v4, Lucide icons |
| Back-end | Fastify 5 with `@fastify/websocket` (native WebSockets) |
| Tests | `node:test` |

The UI follows the blueprint's dark palette — `#0f212e` page, `#1a2c38` panels,
`#213743` borders and a `#00e701` accent — with premium analytical cards, a live
confidence bar, and flashing green status nodes for connection state.

## Layout

```
.
├── client/                     # Vite + React dashboard
│   └── src/
│       ├── App.jsx             # Tab shell, load/error states, footer
│       ├── components/
│       │   ├── NavBar.jsx           # Tabs + live connection node
│       │   ├── PredictionsPanel.jsx # Slip cards, confidence bars, copy-to-clipboard
│       │   ├── TrackerPanel.jsx     # Stat tiles + settlement audit table
│       │   ├── ChatPanel.jsx        # Punter lounge room + composer
│       │   └── SampleDataNotice.jsx # On-screen sample-data disclosure
│       └── hooks/
│           ├── useLoungeSocket.js   # WebSocket lifecycle, replay, reconnect
│           └── useSlipData.js       # REST loader for slips + tracker
└── server/                     # Fastify engine
    ├── src/
    │   ├── server.js           # HTTP routes, WS route, graceful shutdown
    │   ├── lounge.js           # Room state: validation, rate limits, fan-out
    │   └── data.js             # Sample fixtures + derived tracker summary
    └── test/lounge.test.js
```

## Running it

```bash
npm install          # installs both workspaces
npm run dev          # Fastify on :5000 and Vite on :5173 together
```

Open http://localhost:5173. Vite proxies `/api` and `/ws` to the engine, so the
browser only ever talks to one origin in development.

Individually:

```bash
npm run dev:server   # Fastify only, with --watch
npm run dev:client   # Vite only
npm run build        # production client bundle into client/dist
npm test             # server test suite
```

### Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `5000` | Engine listen port |
| `HOST` | `0.0.0.0` | Engine bind address |
| `CORS_ORIGIN` | `http://localhost:5173` | Allowed browser origin |
| `VITE_API_TARGET` | `http://localhost:5000` | Dev-server proxy target |
| `VITE_WS_URL` | *(unset)* | Absolute WS URL, when not proxying |

## API

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Status, connected client count, uptime |
| `GET /api/predictions` | Prediction slips (`sampleData: true`) |
| `GET /api/tracker` | Win rate, streak and settlement audit rows |
| `WS /ws/punter-lounge` | Live chat room |

### WebSocket protocol

Clients send `{ "user": string, "msg": string, "tag": string | null }`.

The server replies with tagged frames:

| Frame | Payload | When |
| --- | --- | --- |
| `history` | `{ messages: [...] }` | On connect, replaying the last 50 messages |
| `message` | `{ message: {...} }` | A message was accepted and fanned out |
| `presence` | `{ online: number }` | Someone joined or left |
| `error` | `{ reason, message }` | Payload rejected, e.g. `rate_limited` |

The room hardens the blueprint's broadcast loop:

- **Validation** — non-string fields are ignored, whitespace is collapsed, and
  usernames, messages and tags are capped (32 / 500 / 24 characters). Empty and
  malformed payloads are dropped without killing the socket.
- **Rate limiting** — 8 messages per 10-second sliding window per socket; over
  budget the sender gets an `error` frame instead of a broadcast.
- **Presence** — a 30-second ping/pong sweep terminates sockets that stopped
  answering, so the online count cannot drift upward from dead connections.
- **Replay** — the last 50 messages are kept in memory so a joiner sees context.

State lives in memory, which is fine for one node. Multiple instances need a
shared bus (Redis pub/sub or similar) plus a real message store.

## Sample data and honest framing

The blueprint labelled the dashboard's hardcoded numbers as an "AI Verified Win
Rate" of 86.4% on a 9-win streak, alongside chat lines praising that streak. As
written, that presents invented figures and invented testimonials as a real
track record to people deciding whether to stake real money. This build keeps
the layout and the component design intact, and changes how the numbers present
themselves:

- `buildAccuracyHistory()` **derives** the win rate, streak and total from the
  audit rows instead of hardcoding them, so the headline can never contradict
  the table beneath it.
- A `SampleDataNotice` sits on the predictions and tracker tabs, and the footer
  states plainly that the app places no bets and connects to no sportsbook.
- Tiles read "Sample Win Rate" and "Rows In Sample"; slip codes read "Sample
  Booking Slip".
- The seeded chat lines no longer advertise a streak, and the lounge sidebar
  notes that room messages are unvetted user content.
- The footer carries a BeGambleAware link and an 18+ note.

If you connect a real data source, replace `server/src/data.js`, keep the
derivation rather than reintroducing fixed figures, and only drop the sample-data
notice once the numbers are genuinely auditable.
