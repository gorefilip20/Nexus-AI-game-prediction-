'use strict';

const { PRIORITIES } = require('./quota');

/**
 * Adaptive refresh scheduling.
 *
 * A fixture is not equally interesting at every moment: one kicking off in
 * three days is worth checking twice a day, one in play is worth checking every
 * minute. Polling everything on a fixed interval spends the same allowance on
 * both and runs out before the evening's matches finish.
 *
 * This assigns each fixture a cadence and a priority from how close it is to
 * kickoff and whether it is live, then hands the quota manager an ordered plan
 * it can cut off wherever the budget runs out.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** In-play status codes across the three sports. */
const LIVE_STATUSES = new Set([
  '1H', '2H', 'HT', 'ET', 'BT', 'P', 'LIVE', 'INTR',      // football
  'Q1', 'Q2', 'Q3', 'Q4', 'OT', 'BT1',                     // basketball
  'S1', 'S2', 'S3', 'S4', 'S5',                            // volleyball
]);

/**
 * Cadence tiers, coarsest last. The first match wins.
 * `within` is milliseconds until kickoff; null means "no upper bound".
 */
const TIERS = [
  { name: 'live', live: true, interval: 1 * MINUTE, priority: 'high' },
  { name: 'imminent', within: 1 * HOUR, interval: 5 * MINUTE, priority: 'high' },
  { name: 'today', within: 6 * HOUR, interval: 30 * MINUTE, priority: 'normal' },
  { name: 'soon', within: 24 * HOUR, interval: 2 * HOUR, priority: 'normal' },
  { name: 'distant', within: null, interval: 6 * HOUR, priority: 'low' },
];

/** Tier urgency, coarsest last — used to order work within a priority band. */
const TIER_RANK = Object.fromEntries(TIERS.map((tier, index) => [tier.name, index]));

function isLive(fixture) {
  return LIVE_STATUSES.has(String(fixture?.status?.short ?? '').toUpperCase());
}

/**
 * Cadence for one fixture.
 * @returns {{tier: string, intervalMs: number, priority: string}|null}
 *   null when the fixture needs no further polling.
 */
function classifyFixture(fixture, now = new Date()) {
  if (!fixture) return null;
  // A finished fixture only matters to settlement, which is scheduled separately.
  if (fixture.status?.finished) return null;

  if (isLive(fixture)) {
    const tier = TIERS[0];
    return { tier: tier.name, intervalMs: tier.interval, priority: tier.priority };
  }

  const kickoff = fixture.kickoff ? new Date(fixture.kickoff).getTime() : null;
  if (!kickoff || Number.isNaN(kickoff)) {
    const tier = TIERS[TIERS.length - 1];
    return { tier: tier.name, intervalMs: tier.interval, priority: tier.priority };
  }

  const untilKickoff = kickoff - now.getTime();

  // Past kickoff but not yet marked live: treat as imminent so the transition
  // into in-play is picked up promptly.
  if (untilKickoff <= 0) {
    const tier = TIERS[1];
    return { tier: tier.name, intervalMs: tier.interval, priority: tier.priority };
  }

  for (const tier of TIERS) {
    if (tier.live) continue;
    if (tier.within === null || untilKickoff <= tier.within) {
      return { tier: tier.name, intervalMs: tier.interval, priority: tier.priority };
    }
  }

  return null;
}

/** True when enough time has passed since this fixture was last refreshed. */
function isDue(fixture, lastRefreshedAt, now = new Date()) {
  const plan = classifyFixture(fixture, now);
  if (!plan) return false;
  if (!lastRefreshedAt) return true;
  return now.getTime() - new Date(lastRefreshedAt).getTime() >= plan.intervalMs;
}

/**
 * Builds an ordered refresh plan and cuts it where the budget runs out.
 *
 * @param {object[]} fixtures
 * @param {Map<string, number>} lastRefreshed  keyed `${sport}:${id}`
 * @param {object} quota  a QuotaManager
 * @returns {{refresh: object[], skipped: object[], estimatedRequests: object}}
 */
function planRefresh({ fixtures = [], lastRefreshed = new Map(), quota, now = () => new Date() } = {}) {
  const at = now();

  const candidates = [];
  for (const fixture of fixtures) {
    const plan = classifyFixture(fixture, at);
    if (!plan) continue;

    const key = `${fixture.sport}:${fixture.id}`;
    if (!isDue(fixture, lastRefreshed.get(key), at)) continue;

    candidates.push({ fixture, key, ...plan });
  }

  // Most urgent first, then soonest kickoff — so a budget cut drops the least
  // time-sensitive work rather than whatever happened to sort last.
  //
  // Tier is compared before kickoff because `live` and `imminent` share a
  // priority band: an in-play match changes minute to minute and must outrank
  // one that has not started, whatever their kickoff times say.
  candidates.sort((a, b) => {
    const byPriority = PRIORITIES[a.priority] - PRIORITIES[b.priority];
    if (byPriority !== 0) return byPriority;

    const byTier = TIER_RANK[a.tier] - TIER_RANK[b.tier];
    if (byTier !== 0) return byTier;

    return (a.fixture.timestamp ?? 0) - (b.fixture.timestamp ?? 0);
  });

  const refresh = [];
  const skipped = [];
  const estimatedRequests = {};

  for (const candidate of candidates) {
    const sport = candidate.fixture.sport;

    if (!quota) {
      refresh.push(candidate);
      estimatedRequests[sport] = (estimatedRequests[sport] ?? 0) + 1;
      continue;
    }

    const verdict = quota.canSpend(sport, candidate.priority);
    if (verdict.allowed) {
      refresh.push(candidate);
      estimatedRequests[sport] = (estimatedRequests[sport] ?? 0) + 1;
    } else {
      skipped.push({ ...candidate, reason: verdict.reason });
    }
  }

  return { refresh, skipped, estimatedRequests, plannedAt: at.toISOString() };
}

/**
 * How long until the next fixture becomes due, so a caller can sleep exactly
 * that long instead of waking on a fixed timer to find nothing to do.
 */
function msUntilNextDue({ fixtures = [], lastRefreshed = new Map(), now = () => new Date() } = {}) {
  const at = now();
  let soonest = Infinity;

  for (const fixture of fixtures) {
    const plan = classifyFixture(fixture, at);
    if (!plan) continue;

    const key = `${fixture.sport}:${fixture.id}`;
    const last = lastRefreshed.get(key);
    if (!last) return 0;

    const due = new Date(last).getTime() + plan.intervalMs - at.getTime();
    soonest = Math.min(soonest, Math.max(due, 0));
  }

  return Number.isFinite(soonest) ? soonest : null;
}

module.exports = {
  classifyFixture,
  isDue,
  isLive,
  planRefresh,
  msUntilNextDue,
  TIERS,
  TIER_RANK,
  LIVE_STATUSES,
};
