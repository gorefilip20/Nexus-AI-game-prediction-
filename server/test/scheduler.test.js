'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyFixture,
  isDue,
  isLive,
  planRefresh,
  msUntilNextDue,
} = require('../src/scheduler');
const { QuotaManager } = require('../src/quota');

const silentLogger = { warn() {}, info() {}, error() {} };
const NOW = new Date('2026-09-01T12:00:00Z');

/** A fixture `minutes` from now, in the given status. */
const fixture = (id, minutes, short = 'NS', sport = 'football') => {
  const kickoff = new Date(NOW.getTime() + minutes * 60_000);
  return {
    sport,
    id,
    kickoff: kickoff.toISOString(),
    timestamp: Math.floor(kickoff.getTime() / 1000),
    status: {
      short,
      finished: ['FT', 'AET', 'PEN'].includes(short),
      notStarted: short === 'NS',
    },
  };
};

const quotaWith = (remaining, at = NOW) => {
  const manager = new QuotaManager({ dailyLimit: 100, logger: silentLogger, now: () => at });
  manager.observeHeaders('football', {
    get: (n) =>
      n === 'x-ratelimit-requests-remaining' ? String(remaining) :
      n === 'x-ratelimit-requests-limit' ? '100' : null,
  });
  return manager;
};

test('in-play statuses are recognised across all three sports', () => {
  assert.ok(isLive({ status: { short: '1H' } }), 'football first half');
  assert.ok(isLive({ status: { short: 'Q3' } }), 'basketball third quarter');
  assert.ok(isLive({ status: { short: 'S2' } }), 'volleyball second set');
  assert.ok(isLive({ status: { short: 'ht' } }), 'case insensitive');
  assert.ok(!isLive({ status: { short: 'NS' } }));
  assert.ok(!isLive({}));
});

test('cadence tightens as kickoff approaches', () => {
  const tiers = [
    [fixture(1, 30, '1H'), 'live', 60_000],
    [fixture(2, 20), 'imminent', 300_000],
    [fixture(3, 180), 'today', 1_800_000],
    [fixture(4, 720), 'soon', 7_200_000],
    [fixture(5, 4320), 'distant', 21_600_000],
  ];

  for (const [f, expectedTier, expectedInterval] of tiers) {
    const plan = classifyFixture(f, NOW);
    assert.equal(plan.tier, expectedTier);
    assert.equal(plan.intervalMs, expectedInterval);
  }
});

test('intervals increase monotonically with distance from kickoff', () => {
  const intervals = [30, 180, 720, 4320].map((m) => classifyFixture(fixture(1, m), NOW).intervalMs);
  for (let i = 1; i < intervals.length; i += 1) {
    assert.ok(intervals[i] > intervals[i - 1], 'a more distant fixture must be polled less often');
  }
});

test('a finished fixture is never polled again', () => {
  assert.equal(classifyFixture(fixture(1, -120, 'FT'), NOW), null);
  assert.equal(classifyFixture(null, NOW), null);
});

test('a fixture past kickoff but not yet live is treated as imminent', () => {
  const plan = classifyFixture(fixture(1, -5, 'NS'), NOW);
  assert.equal(plan.tier, 'imminent', 'the transition into play must be picked up promptly');
});

test('a fixture with no usable kickoff falls back to the slowest cadence', () => {
  assert.equal(classifyFixture({ sport: 'football', id: 1, status: {} }, NOW).tier, 'distant');
  assert.equal(
    classifyFixture({ sport: 'football', id: 1, kickoff: 'not a date', status: {} }, NOW).tier,
    'distant',
  );
});

test('live fixtures carry a higher priority than distant ones', () => {
  assert.equal(classifyFixture(fixture(1, 10, '1H'), NOW).priority, 'high');
  assert.equal(classifyFixture(fixture(2, 4320), NOW).priority, 'low');
});

test('a fixture is due only once its interval has elapsed', () => {
  const live = fixture(1, 30, '1H');
  assert.equal(isDue(live, null, NOW), true, 'never refreshed means due');
  assert.equal(isDue(live, new Date(NOW.getTime() - 30_000).toISOString(), NOW), false);
  assert.equal(isDue(live, new Date(NOW.getTime() - 61_000).toISOString(), NOW), true);
});

test('a finished fixture is never due', () => {
  assert.equal(isDue(fixture(1, -120, 'FT'), null, NOW), false);
});

test('the plan refreshes only fixtures that are due', () => {
  const live = fixture(1, 30, '1H');
  const distant = fixture(2, 4320);
  const lastRefreshed = new Map([['football:1', new Date(NOW.getTime() - 10_000).toISOString()]]);

  const plan = planRefresh({ fixtures: [live, distant], lastRefreshed, now: () => NOW });
  assert.deepEqual(plan.refresh.map((r) => r.fixture.id), [2], 'the live one was just refreshed');
});

test('the plan is ordered by urgency, then by kickoff', () => {
  const plan = planRefresh({
    fixtures: [fixture(5, 4320), fixture(3, 180), fixture(1, -25, '1H'), fixture(2, 20)],
    now: () => NOW,
  });

  const ids = plan.refresh.map((r) => r.fixture.id);
  assert.equal(ids[0], 1, 'live first');
  assert.equal(ids[1], 2, 'then imminent');
  assert.equal(ids[ids.length - 1], 5, 'distant last');
});

test('a live match outranks an imminent one even with a later kickoff', () => {
  // Same priority band, so only the tier ordering separates them.
  const plan = planRefresh({
    fixtures: [fixture(2, 5), fixture(1, -25, '1H')],
    now: () => NOW,
  });

  assert.deepEqual(plan.refresh.map((r) => r.tier), ['live', 'imminent']);
});

test('a tight budget keeps live fixtures and drops distant ones', () => {
  const plan = planRefresh({
    fixtures: [fixture(1, -25, '1H'), fixture(2, 20), fixture(3, 180), fixture(5, 4320)],
    quota: quotaWith(12),
    now: () => NOW,
  });

  const refreshed = plan.refresh.map((r) => r.tier).sort();
  assert.deepEqual(refreshed, ['imminent', 'live']);
  assert.equal(plan.skipped.length, 2);
  assert.ok(plan.skipped.every((s) => /higher-priority/.test(s.reason)));
});

test('an exhausted quota refreshes nothing but still reports why', () => {
  const plan = planRefresh({
    fixtures: [fixture(1, 30, '1H'), fixture(2, 20)],
    quota: quotaWith(0),
    now: () => NOW,
  });

  assert.equal(plan.refresh.length, 0);
  assert.equal(plan.skipped.length, 2);
  assert.ok(plan.skipped.every((s) => /exhausted/.test(s.reason)));
});

test('a healthy budget refreshes everything due', () => {
  const plan = planRefresh({
    fixtures: [fixture(1, 30, '1H'), fixture(2, 20), fixture(3, 180)],
    quota: quotaWith(95, new Date('2026-09-01T23:00:00Z')),
    now: () => NOW,
  });

  assert.equal(plan.refresh.length, 3);
  assert.equal(plan.estimatedRequests.football, 3);
});

test('without a quota manager the plan is unconstrained', () => {
  const plan = planRefresh({ fixtures: [fixture(1, 30, '1H'), fixture(5, 4320)], now: () => NOW });
  assert.equal(plan.refresh.length, 2);
  assert.equal(plan.skipped.length, 0);
});

test('estimated requests are counted per sport', () => {
  const plan = planRefresh({
    fixtures: [fixture(1, 20), fixture(2, 20, 'NS', 'basketball'), fixture(3, 20, 'NS', 'basketball')],
    now: () => NOW,
  });

  assert.equal(plan.estimatedRequests.football, 1);
  assert.equal(plan.estimatedRequests.basketball, 2);
});

test('msUntilNextDue reports zero when something has never been refreshed', () => {
  assert.equal(msUntilNextDue({ fixtures: [fixture(1, 30, '1H')], now: () => NOW }), 0);
});

test('msUntilNextDue returns the soonest deadline across fixtures', () => {
  const lastRefreshed = new Map([
    ['football:1', new Date(NOW.getTime() - 30_000).toISOString()],
    ['football:5', new Date(NOW.getTime() - 60_000).toISOString()],
  ]);

  const wait = msUntilNextDue({
    fixtures: [fixture(1, 30, '1H'), fixture(5, 4320)],
    lastRefreshed,
    now: () => NOW,
  });

  // The live fixture is on a 60s cadence and was refreshed 30s ago.
  assert.ok(wait > 25_000 && wait <= 30_000, `expected about 30s, got ${wait}`);
});

test('msUntilNextDue is null when nothing needs polling', () => {
  assert.equal(msUntilNextDue({ fixtures: [fixture(1, -120, 'FT')], now: () => NOW }), null);
  assert.equal(msUntilNextDue({ fixtures: [], now: () => NOW }), null);
});
