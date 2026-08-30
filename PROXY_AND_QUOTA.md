# Egress, quota and continuous updates

## Why this is not a rotating proxy pool

The goal — uninterrupted live data — is right. Rotating requests across an array
of residential proxies does not achieve it, for three reasons.

**1. The quota is bound to the subscription, not the IP.**
API-Sports counts requests against your API key. A hundred requests a day
arriving from a hundred different IPs is still a hundred requests against the
same key. Rotation cannot buy a single extra call.

**2. The provider's IP handling works against rotation, not for it.**
API-Football's own guidance is that rate-limit protection considers the source
IP *alongside* the key, that shared or unstable outbound IPs reduce effective
capacity, and that **"for production integrations, using a dedicated static IP
remains the best way to avoid side effects caused by shared IPs"**
([how ratelimit works](https://www.api-football.com/news/post/how-ratelimit-works)).
That is the opposite of rotation. One key arriving from a churn of residential
addresses is the signature abuse protection is built to catch — the likely
outcome is a suspended account, not more headroom.

**3. It would not be circumvention worth having even if it worked.**
Evading a provider's rate limits breaches the terms the key is issued under. The
platform's continuity would then rest on not being noticed.

So this repository does the two things that actually keep the data flowing:
**one stable egress path**, and **a request budget spent deliberately across the
day**.

## What is built

### Static egress (`server/src/egress.js`)

A single configured proxy for all provider traffic:

```bash
EGRESS_PROXY_URL=http://user:pass@your-static-egress:8080
```

Set it when you have a real reason: a NAT gateway or egress IP the provider has
allowlisted, a corporate network requiring outbound traffic to pass a proxy, or
pinning traffic to one region. Leave it unset and traffic goes direct over a
keep-alive pool, which is the right default for most deployments.

Credentials are redacted from every log line. A malformed or SOCKS URL fails at
construction rather than at the first request.

There is deliberately no rotation and no pool. If you are behind serverless
infrastructure with shared outbound IPs — Lambda, Cloud Run, Vercel, Netlify
Functions — this is the setting that fixes it: point it at one dedicated static
IP. (That is a second reason this backend belongs on a container or VM; see
DEPLOYMENT.md.)

### Request budget (`server/src/quota.js`)

Tracks what the provider itself reports (`x-ratelimit-requests-remaining`,
`x-ratelimit-requests-limit`) per sport, resetting at 00:00 UTC to mirror the
provider's own reset. Its own count is authoritative; a locally-tracked number
drifts the moment anything else shares the key.

Two mechanisms keep the allowance lasting:

**Pacing** — the day's allowance is spread across the seconds remaining in it.
Spending ahead of that line defers non-urgent work rather than racing to zero by
lunchtime.

**Reserves** — each priority tier may only draw down to its own floor:

| Tier | Used for | Floor |
| --- | --- | --- |
| `critical` | Settling a finished fixture | 0% — always runs |
| `high` | In-play fixtures | 5% |
| `normal` | Board refresh, odds | 15% |
| `low` | League history, search | 30% |

So an afternoon of user searches can never leave settlement unable to grade a
match at 23:00. Critical work also ignores pacing: a finished fixture must be
graded today or the tracker is permanently wrong.

A `429` records the cooldown (honouring `Retry-After`) and pauses **that sport
only**. It does not retry inline — sleeping out a cooldown would pin a request
handler open for the whole window, and every concurrent caller would do the
same. The pause is held in the scheduler instead.

### Adaptive scheduling (`server/src/scheduler.js`)

A fixture is not equally interesting at every moment. Polling everything on one
fixed interval spends the same allowance on a match three days out as on one in
play, and runs dry before the evening's games finish.

| Tier | When | Cadence | Priority |
| --- | --- | --- | --- |
| `live` | In play | 1 min | high |
| `imminent` | Kickoff < 1 h, or started but not yet marked live | 5 min | high |
| `today` | Kickoff < 6 h | 30 min | normal |
| `soon` | Kickoff < 24 h | 2 h | normal |
| `distant` | Beyond that | 6 h | low |

Finished fixtures are never polled again — settlement handles them separately.

`planRefresh()` orders due fixtures by priority, then by tier, then by kickoff,
and cuts the list wherever the budget runs out. Ordering by tier before kickoff
matters because `live` and `imminent` share a priority band: an in-play match
changes minute to minute and must outrank one that has not started, whatever
their kickoff times say. When the budget is tight, live matches keep updating
and distant fixtures wait.

`msUntilNextDue()` reports exactly how long until the next fixture needs
attention, so a caller can sleep that long instead of waking on a fixed timer to
find nothing to do.

## Monitoring

`GET /api/meta` reports per-sport budget state:

```json
{
  "egress": "direct",
  "quotaDetail": {
    "football": { "limit": 100, "remaining": 63, "spent": 37,
                  "pacedAllowance": 50, "blockedUntil": null }
  }
}
```

`remaining` well below `pacedAllowance` means you are burning the allowance too
fast — raise the cache TTLs, lower `FIXTURES_PER_SPORT`, or move to a paid tier.
A non-null `blockedUntil` means that sport is in a provider-imposed cooldown.

## If you genuinely need more requests

In order of how much they buy:

1. **Raise the tier.** API-Sports paid plans start around $19/month and lift the
   ceiling by orders of magnitude. This is by far the cheapest fix — a
   residential proxy pool costs more than the subscription it is trying to
   avoid.
2. **Raise the cache TTLs.** League history changes only when matches finish;
   the default is already 6 hours and can go higher.
3. **Lower `FIXTURES_PER_SPORT`.** Each fixture costs an odds call.
4. **Set `QUOTA_DAILY_LIMIT`** to match your real plan so pacing works against
   the true ceiling rather than the free tier's 100.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `EGRESS_PROXY_URL` | *(unset)* | Single static egress proxy; direct when unset |
| `EGRESS_KEEPALIVE_MS` | `30000` | Connection reuse window |
| `QUOTA_ENABLED` | `true` | Set `false` to disable pacing and reserves |
| `QUOTA_DAILY_LIMIT` | `100` | Requests per sport per UTC day; match your plan |
