'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { BoardSnapshot, msUntilUtcReset, isBudgetExhaustion } = require('../src/snapshot');

const silentLogger = { warn() {}, info() {}, error() {} };

const board = (slipCount = 2) => ({
  provider: 'api-sports',
  live: true,
  fetchedAt: '2026-09-01T20:00:00Z',
  degraded: [],
  slips: Array.from({ length: slipCount }, (_, i) => ({
    sport: 'football',
    id: i + 1,
    home: 'Arsenal',
    away: 'Chelsea',
    model: { outcome: { home: 58.2, draw: 22.9, away: 19 } },
    insight: { matchJustification: `analysis for fixture ${i + 1}` },
  })),
});

function snapshotAt(iso) {
  const clock = { now: new Date(iso) };
  return {
    clock,
    snapshot: new BoardSnapshot({ logger: silentLogger, now: () => clock.now }),
  };
}

test('msUntilUtcReset counts to the next midnight UTC', () => {
  const hours = msUntilUtcReset(new Date('2026-09-01T21:30:00Z')) / 3_600_000;
  assert.ok(Math.abs(hours - 2.5) < 0.01, `expected 2.5h, got ${hours}`);

  const atMidnight = msUntilUtcReset(new Date('2026-09-01T00:00:00Z')) / 3_600_000;
  assert.ok(Math.abs(atMidnight - 24) < 0.01);
});

test('an empty store has nothing to serve', () => {
  const { snapshot } = snapshotAt('2026-09-01T20:00:00Z');
  assert.equal(snapshot.has(), false);
  assert.equal(snapshot.read(), null);
  assert.equal(snapshot.describe().present, false);
});

test('a stored board is served back with staleness metadata', () => {
  const { snapshot, clock } = snapshotAt('2026-09-01T20:00:00Z');
  assert.equal(snapshot.store(board()), true);

  clock.now = new Date('2026-09-01T21:00:00Z');
  const cached = snapshot.read('the daily request budget is spent');

  assert.equal(cached.stale, true);
  assert.equal(cached.staleReason, 'the daily request budget is spent');
  assert.equal(cached.ageSeconds, 3600);
  assert.equal(cached.cachedAt, '2026-09-01T20:00:00.000Z');
  assert.equal(cached.liveUpdatesResumeAt, '2026-09-02T00:00:00.000Z');
});

test('the cached analytical breakdown survives intact', () => {
  const { snapshot, clock } = snapshotAt('2026-09-01T20:00:00Z');
  snapshot.store(board(3));

  clock.now = new Date('2026-09-01T23:00:00Z');
  const cached = snapshot.read('quota exhausted');

  assert.equal(cached.slips.length, 3);
  assert.equal(cached.slips[0].insight.matchJustification, 'analysis for fixture 1');
  assert.equal(cached.slips[0].model.outcome.home, 58.2, 'model output is preserved');
});

test('an empty board is never stored over a good one', () => {
  const { snapshot } = snapshotAt('2026-09-01T20:00:00Z');
  snapshot.store(board(2));

  assert.equal(snapshot.store({ slips: [] }), false);
  assert.equal(snapshot.store(null), false);
  assert.equal(snapshot.store({}), false);
  assert.equal(snapshot.read().slips.length, 2, 'the good board must survive');
});

test('a newer board replaces the previous one', () => {
  const { snapshot, clock } = snapshotAt('2026-09-01T20:00:00Z');
  snapshot.store(board(2));

  clock.now = new Date('2026-09-01T20:30:00Z');
  snapshot.store(board(5));

  const cached = snapshot.read();
  assert.equal(cached.slips.length, 5);
  assert.equal(cached.ageSeconds, 0, 'age resets on store');
});

test('a board older than the max age is not served', () => {
  const { snapshot, clock } = snapshotAt('2026-09-01T20:00:00Z');
  snapshot.store(board());

  clock.now = new Date('2026-09-02T19:00:00Z');
  assert.ok(snapshot.read(), 'still inside 24h');

  // Past a day the analysis describes fixtures already played.
  clock.now = new Date('2026-09-02T21:00:00Z');
  assert.equal(snapshot.read(), null);
  assert.equal(snapshot.has(), false);
});

test('the countdown to live updates shrinks as the reset approaches', () => {
  const { snapshot, clock } = snapshotAt('2026-09-01T18:00:00Z');
  snapshot.store(board());

  const early = snapshot.read().liveUpdatesResumeInMs;
  clock.now = new Date('2026-09-01T23:00:00Z');
  const late = snapshot.read().liveUpdatesResumeInMs;

  assert.ok(late < early);
  assert.ok(Math.abs(late - 3_600_000) < 1000, 'one hour to reset');
});

test('describe reports what is held without serving it', () => {
  const { snapshot, clock } = snapshotAt('2026-09-01T20:00:00Z');
  snapshot.store(board(4));

  clock.now = new Date('2026-09-01T20:10:00Z');
  assert.deepEqual(snapshot.describe(), {
    present: true,
    cachedAt: '2026-09-01T20:00:00.000Z',
    ageSeconds: 600,
    slipCount: 4,
  });
});

test('clearing drops the buffer', () => {
  const { snapshot } = snapshotAt('2026-09-01T20:00:00Z');
  snapshot.store(board());
  snapshot.clear();
  assert.equal(snapshot.read(), null);
});

test('budget exhaustion is distinguished from a genuine outage', () => {
  assert.equal(isBudgetExhaustion({ quotaDeferred: true }), true);
  assert.equal(isBudgetExhaustion(new Error('daily quota exhausted')), true);
  assert.equal(isBudgetExhaustion(new Error('holding for higher-priority work')), true);
  assert.equal(isBudgetExhaustion(new Error('Provider rate limited the request')), true);
  assert.equal(isBudgetExhaustion(new Error('getaddrinfo ENOTFOUND')), false);
  assert.equal(isBudgetExhaustion(null), false);
});
