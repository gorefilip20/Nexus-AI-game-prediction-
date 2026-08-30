# NexusBet AI

Multi-sport analytics dashboard, probability engine, settlement tracker and
real-time punter lounge for football, basketball and volleyball.

> **What the numbers are.** Fixtures and odds come from a live sports API. Model
> probabilities are computed here, by fitting per-sport statistical models to
> that league's real finished matches. Nothing on the board is hardcoded — but a
> model probability is an estimate from a fitted model, not a forecast of the
> result, and the tracker's win rate counts only picks this app recorded before
> kickoff. With no API key configured the app runs on clearly-labelled sample data.

## Stack

| Layer | Choice |
| --- | --- |
| Front-end | React 19 + Vite, Tailwind CSS v4, Lucide icons |
| Back-end | Fastify 5 with `@fastify/websocket` |
| Data | [API-Sports](https://api-sports.io/) — football v3, basketball v1, volleyball v1 |
| Models | Poisson / least-squares / logistic regression, hand-rolled (no deps) |
| Tests | `node:test` — 149 cases |

## Quick start

```bash
npm install
cp .env.example .env          # add your API_SPORTS_KEY
npm run verify:provider       # confirm the feed and normalisers agree
npm run dev                   # Fastify :5000 + Vite :5173
```

Open http://localhost:5173. Without a key everything still runs, on sample data.

## Why API-Sports

Volleyball is the constraint. Most affordable sports feeds cover football and
basketball but not volleyball; API-Sports covers all three behind one key, with
a consistent envelope and a free tier of **100 requests/day per sport** (resets
00:00 UTC). Paid plans start around $19/month.

Everything vendor-specific lives in `server/src/providers/`. Swapping feeds means
adding one factory that satisfies the same `getSlips` / `getHistory` /
`getResults` contract — nothing outside that directory knows the vendor.

### Request budget

A full board refresh costs, per sport: 1 fixture list + 1 odds call per fixture +
1 league-history call per distinct league. With the default 3 fixtures per sport
that is roughly 20 requests per cold refresh across all three sports. Caching
keeps steady-state cost far lower:

| Data | TTL | Why |
| --- | --- | --- |
| Fixtures | 5 min | Kickoff times and line-ups move slowly |
| Odds | 15 min | Prices drift, but not every minute |
| Results | 10 min | Only matters around settlement |
| League history | 6 h | Only changes when matches finish |

Concurrent requests for the same key are collapsed into one upstream call, and a
failed refresh serves the last good value rather than blanking the board.

## The probability engine

Each sport gets the model its scoring process actually justifies. Using Poisson
for all three would be wrong: basketball scores are not rare events, and a
volleyball match is a race to three sets, not a scoreline.

| Sport | Model | Fitted on | Markets |
| --- | --- | --- | --- |
| Football | Poisson regression on goals + Dixon-Coles low-score correction | finished league fixtures | 1X2, O/U, Asian handicap, BTTS, correct score |
| Basketball | Ridge least-squares on points, normal margin/total | finished league games | Moneyline, spread, totals |
| Volleyball | Logistic regression on set outcomes, race-to-3 expansion | finished league games | Match winner, set handicap, total sets |

### Football

Fits, by penalised maximum likelihood over real results:

```
log λ_home = μ + attack[home] − defence[away] + homeAdvantage
log λ_away = μ + attack[away] − defence[home]
```

Attack and defence are re-centred each step (only differences are identifiable),
an L2 penalty shrinks thin-sample teams toward league average, and matches are
exponentially recency-weighted (240-day half-life) so current form dominates.

Every market is read off **one** joint score matrix, so 1X2, over/under and
handicap numbers cannot contradict each other. The Dixon-Coles ρ is fitted by
grid search; it corrects the four low scorelines independent Poisson misprices.

### Basketball

Points are sums of many possessions, so the margin is approximately normal.
Team offence/defence ratings come from a ridge least-squares fit; the margin and
total standard deviations are **measured from fit residuals**, not assumed.

### Volleyball

Set win probability comes from a logistic fit on historical set outcomes, where
each match contributes its sets as weighted Bernoulli trials — so a 3–2 counts as
much weaker evidence than a 3–0. Match markets then follow in closed form; the
race-to-3 win probability `p³(1 + 3q + 6q²)` is asserted against the model output
in the test suite.

### When the model declines to answer

It returns nothing — and the UI says so — when there are no finished fixtures to
fit, or when a team never appears in training (a newly promoted side). A thin fit
is served flagged `reliable: false` and rendered as "provisional" with its sample
size. **No probability is ever invented to fill a gap.**

## The scenario CLI

Runs the engine against one named fixture, the "Chelsea vs Brighton today" check:

```bash
API_SPORTS_KEY=... npm run scenario -- "Chelsea vs Brighton"
API_SPORTS_KEY=... node scripts/scenario.js "Lakers vs Celtics" --sport basketball
API_SPORTS_KEY=... node scripts/scenario.js "Italy vs Brazil" --date 2026-09-01
```

It finds the real fixture in the schedule, fits that league's model on its real
finished matches, and prints outcome, totals, handicap, BTTS and scoreline
probabilities, plus a model-vs-market edge where odds exist.

If the fixture is not on the schedule that day it says so, lists what actually
is, and exits non-zero. It will not price a match that is not being played.

## Slip codes

```
NB1-<SPORT>-<FIXTURE_ID>-<MARKET>-<SELECTION>[-<LINE>]-<CHECK>
NB1-FB-239625-1X2-H-7B
```

Copyable, checksummed, and decodable back to the exact fixture and selection via
`decodeSlip()`. A tampered or truncated code fails its checksum rather than
resolving to the wrong match.

**These are not Stake booking codes.** A real booking code is minted by that
sportsbook from its own internal market ids; it cannot be computed from outside,
and a convincing imitation would simply fail when pasted in — or load something
the user did not choose. This encodes the selection honestly instead, and the UI
says plainly that it will not load a slip on Stake or anywhere else.

## Match analysis

Every fixture carries a generated `matchJustification` string plus a structured
`insight` object, both produced by `server/src/insight.js` from data the app
already holds. The UI renders it as an expandable **AI Insight & Analysis** panel
under each card.

It is a **rule-based generator, not a language model**. Every sentence is derived
from the fitted model, that league's finished results and the live odds ladder,
so a justification cannot assert something the numbers do not support. The panel
says as much in its provenance line.

Bullets cover:

- **Model** — the fit, its training sample and its outcome probabilities.
- **Team form** — each side's last 6 finished fixtures: record, form string,
  current run, and scored/conceded per match, in that sport's own unit
  (goals / points / sets).
- **Head-to-head** — prior meetings from the fitted dataset, oriented to the
  upcoming home side, with the most recent result.
- **Expected value** — per outcome: `EV = p_model × decimalOdds − 1`, alongside
  the gap against the devigged market price.

Both are reported because they answer different questions: a large EV on a long
price and a small disagreement with the market are not the same thing. A caveat
always accompanies a value claim — a closing market is usually better calibrated
than a single-season model, so a positive gap is a prompt to look closer, not a
proven edge. Thin fits, missing markets and absent head-to-head history are each
called out rather than quietly omitted.

The justification is stored with the pick in the ledger, so a settled result can
be read back against the reasoning that produced it.

## Global search

A search bar and sport filter sit above the tabs and span every sport, so a query
is not scoped to whichever tab is open.

```
GET /api/search?q=Brighton&sport=football&days=2&limit=12
```

Matches on either team or the league, substring in both directions, so
`Brighton` finds `Brighton & Hove Albion`. Results come back as full prediction
cards — priced, modelled and analysed, identical in shape to the main board,
because both go through the same `enrichSlips` path.

Quota discipline matters here: each scanned day costs one schedule request per
sport. So queries under two characters are rejected before any upstream call,
input is debounced 350 ms, in-flight requests are aborted when the query moves
on, `days` is capped at 7, and the day range is a visible control rather than a
hidden default. An empty result reports how many fixtures were actually scanned,
so "nothing found" stays distinguishable from "the feed was down".

## The tracker

No sports API can report *your* win rate — it knows fixtures and results, not
which picks you made. So a truthful accuracy figure needs the picks written down
before kickoff and graded afterwards, which is what `server/src/ledger.js` does:

1. Every priced slip the board shows is recorded once, with its price and
   probability at the time it was shown. Re-recording is refused, so a later,
   better price can never overwrite the pick that was actually displayed.
2. A settlement pass (every 15 minutes, or `POST /api/settle`) grades pending
   picks against final scores.
3. `winRate` is `null` until something settles — not `0`, and never a placeholder.
   Abandoned fixtures grade `VOID` so they neither flatter nor penalise the record.

## API

| Endpoint | Description |
| --- | --- |
| `GET /api/health` | Status, connected clients, provider, uptime |
| `GET /api/predictions` | Board: fixtures, odds, model probabilities, analysis, slip codes |
| `GET /api/search?q=&sport=&days=&limit=` | Team/league search across sports and dates |
| `GET /api/tracker` | Win rate, streak and the settlement ledger |
| `GET /api/meta` | Provider, quota remaining, model toggle |
| `POST /api/settle` | Force a settlement pass |
| `WS /ws/punter-lounge` | Live chat room |

### WebSocket protocol

Clients send `{ "user": string, "msg": string, "tag": string | null }`. The
server replies with tagged frames: `history` (last 50 on connect), `message`,
`presence`, and `error` (e.g. `rate_limited`).

The room validates and caps every field (32 / 500 / 24 chars), rate-limits to 8
messages per 10s per socket, and runs a 30-second ping/pong sweep so the online
count cannot drift upward from dead connections. State is in-memory: multiple
instances would need a shared bus.

## Layout

```
client/src/
  App.jsx                      Tab shell, load/error states, footer
  components/
    NavBar.jsx                 Tabs + live connection node
    PredictionsPanel.jsx       Slip cards, market odds, slip codes
    ModelBreakdown.jsx         Model probabilities, expandable markets
    InsightPanel.jsx           AI Insight & Analysis panel
    PredictionCard.jsx         One fixture, shared by board and search
    SearchBar.jsx              Global team/league search + sport filter
    SearchResults.jsx          Search result grid
    TrackerPanel.jsx           Stat tiles + settlement audit
    ChatPanel.jsx              Punter lounge + composer
    DataProvenanceNotice.jsx   Says where the numbers came from
  hooks/
    useLoungeSocket.js         WS lifecycle, replay, reconnect
    useSlipData.js             REST loader + 5-minute refresh
    useFixtureSearch.js        Debounced, abortable search

server/src/
  server.js                    Routes, settlement loop, shutdown
  board.js                     Provider + models -> the board (shared enrichment)
  insight.js                   Rule-based form, head-to-head and EV analysis
  search.js                    Multi-sport, multi-day fixture search
  config.js                    Env config
  http.js                      Timeouts, retries, API-Sports error handling
  cache.js                     TTL cache, stale-on-error, request collapsing
  odds.js                      Implied probability, overround, devig
  slip.js                      Slip code encode/decode
  ledger.js                    Pick recording and settlement
  scenario.js                  Named-fixture analysis
  lounge.js                    Chat room state
  models/
    poisson.js                 Score matrix and football markets
    regression.js              Poisson regression + Dixon-Coles rho
    normal.js                  Basketball ratings and normal markets
    sets.js                    Volleyball set model
    index.js                   Per-sport dispatch
  providers/
    apiSports.js               API-Sports client and normalisers
    sample.js                  Offline fallback
```

## Commands

```bash
npm run dev              # server + client
npm run build            # production client bundle
npm test                 # 149 tests
npm run verify:provider  # live smoke check against your key
npm run scenario -- "Chelsea vs Brighton"
npm run check:secrets    # blocks a tracked or bundle-exposed credential
```

## Production

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for platform-by-platform instructions,
crash-recovery layers and the scaling constraints.

The short version: the backend is a **long-lived stateful process** (WebSockets,
in-memory cache, fitted models, settlement timer), so it needs a container or a
VM — not a serverless platform. Netlify can host the client but not this API.
`docker compose up -d --build` gives crash recovery and a persistent ledger
volume; `ecosystem.config.cjs` is the PM2 equivalent for a plain VM.

Configuration is validated at boot and the server **refuses to start** on a fatal
misconfiguration — a wildcard CORS origin in production, a missing provider key,
or a secret exposed to the browser through a `VITE_` prefix.

## Configuration

See `.env.example` for the full list. The essentials:

| Variable | Default | Purpose |
| --- | --- | --- |
| `API_SPORTS_KEY` | *(unset)* | Provider key; unset falls back to sample data |
| `API_SPORTS_MODE` | `direct` | `direct` or `rapidapi` |
| `FIXTURES_PER_SPORT` | `3` | Board size per sport |
| `MODEL_ENABLED` | `true` | Set `false` to run on odds alone |
| `SETTLEMENT_INTERVAL_MS` | `900000` | Settlement pass cadence |

## Odds handling

Bookmaker odds carry a margin: raw implied probabilities sum to more than 1.
`server/src/odds.js` strips it before anything is displayed, so a shown market
percentage is the market's actual view rather than the bookmaker's padded number.
The overround is retained and reported alongside.

## Honest framing

This is a dashboard over public fixture and odds data. It places no bets and is
not affiliated with any sportsbook. Model output is an estimate from a fitted
statistical model with a stated sample size — not a prediction of what will
happen, and not advice. Betting risks real money and past results never predict
future ones. Support: [BeGambleAware](https://www.begambleaware.org/). 18+.
