'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { PredictionLedger, winnerLabel } = require('../src/ledger');
const { TtlCache } = require('../src/cache');

const silentLogger = { info() {}, warn() {}, error() {} };

async function tempLedger() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'nexusbet-ledger-'));
  return new PredictionLedger({
    filePath: path.join(dir, 'ledger.json'),
    logger: silentLogger,
  });
}

const slip = (overrides = {}) => ({
  sport: 'football',
  id: 239625,
  ref: 'NB-FO-239625',
  league: 'Premier League',
  home: 'Arsenal',
  away: 'Chelsea',
  kickoff: '2026-09-01T14:00:00+00:00',
  prediction: 'Arsenal to Win',
  pickLabel: 'Home',
  probability: 49.4,
  odd: 1.9,
  bookmaker: 'Bwin',
  oddsAvailable: true,
  ...overrides,
});

const finished = (home, away, short = 'FT') => ({
  homeScore: home,
  awayScore: away,
  status: { short, finished: true },
});

test('winnerLabel reads the outcome from the score', () => {
  assert.equal(winnerLabel({ homeScore: 2, awayScore: 1 }), 'Home');
  assert.equal(winnerLabel({ homeScore: 0, awayScore: 3 }), 'Away');
  assert.equal(winnerLabel({ homeScore: 1, awayScore: 1 }), 'Draw');
  assert.equal(winnerLabel({ homeScore: null, awayScore: 1 }), null);
});

test('only priced slips are recorded', async () => {
  const ledger = await tempLedger();
  const added = ledger.record([
    slip(),
    slip({ id: 2, oddsAvailable: false }),
    slip({ id: 3, pickLabel: null }),
  ]);
  assert.equal(added, 1);
  assert.equal(ledger.summary().pendingCount, 1);
});

test('recording is idempotent so a shown pick is never overwritten', async () => {
  const ledger = await tempLedger();
  ledger.record([slip()]);
  const added = ledger.record([slip({ odd: 2.5, prediction: 'Arsenal to Win (drifted)' })]);

  assert.equal(added, 0);
  assert.equal(ledger.summary().rows[0].odd, 1.9);
});

test('an empty ledger reports no win rate rather than zero', async () => {
  const ledger = await tempLedger();
  const summary = ledger.summary();

  assert.equal(summary.winRate, null);
  assert.equal(summary.settledCount, 0);
  assert.equal(summary.currentStreak, 0);
  assert.equal(summary.sampleData, false);
});

test('a correct pick settles as a WIN and moves the win rate', async () => {
  const ledger = await tempLedger();
  ledger.record([slip()]);

  const settled = ledger.settle(new Map([['football:239625', finished(2, 1)]]));
  const summary = ledger.summary();

  assert.equal(settled, 1);
  assert.equal(summary.wins, 1);
  assert.equal(summary.losses, 0);
  assert.equal(summary.winRate, 100);
  assert.equal(summary.currentStreak, 1);
  assert.equal(summary.pendingCount, 0);
});

test('a wrong pick settles as a LOSS', async () => {
  const ledger = await tempLedger();
  ledger.record([slip()]);
  ledger.settle(new Map([['football:239625', finished(0, 2)]]));

  const summary = ledger.summary();
  assert.equal(summary.losses, 1);
  assert.equal(summary.winRate, 0);
  assert.equal(summary.currentStreak, 0);
});

test('a draw grades a home pick as a loss in football', async () => {
  const ledger = await tempLedger();
  ledger.record([slip()]);
  ledger.settle(new Map([['football:239625', finished(1, 1)]]));
  assert.equal(ledger.summary().losses, 1);
});

test('an abandoned fixture voids rather than counting against the record', async () => {
  const ledger = await tempLedger();
  ledger.record([slip()]);
  ledger.settle(new Map([['football:239625', finished(null, null, 'ABD')]]));

  const summary = ledger.summary();
  assert.equal(summary.voidCount, 1);
  assert.equal(summary.settledCount, 0);
  assert.equal(summary.winRate, null);
});

test('unfinished fixtures stay pending', async () => {
  const ledger = await tempLedger();
  ledger.record([slip()]);
  const settled = ledger.settle(
    new Map([['football:239625', { homeScore: 1, awayScore: 0, status: { finished: false } }]]),
  );

  assert.equal(settled, 0);
  assert.equal(ledger.summary().pendingCount, 1);
});

test('win rate and streak reflect the settled sequence', async () => {
  const ledger = await tempLedger();
  ledger.record([
    slip({ id: 1 }),
    slip({ id: 2 }),
    slip({ id: 3 }),
    slip({ id: 4 }),
  ]);

  ledger.settle(
    new Map([
      ['football:1', finished(2, 0)],
      ['football:2', finished(0, 1)],
      ['football:3', finished(3, 1)],
      ['football:4', finished(1, 0)],
    ]),
  );

  const summary = ledger.summary();
  assert.equal(summary.settledCount, 4);
  assert.equal(summary.wins, 3);
  assert.equal(summary.winRate, 75);
});

test('pendingReferences lists only ungraded picks', async () => {
  const ledger = await tempLedger();
  ledger.record([slip({ id: 1 }), slip({ id: 2 })]);
  ledger.settle(new Map([['football:1', finished(2, 0)]]));

  assert.deepEqual(ledger.pendingReferences(), [{ sport: 'football', id: 2 }]);
});

test('the ledger survives a save and reload', async () => {
  const ledger = await tempLedger();
  ledger.record([slip()]);
  ledger.settle(new Map([['football:239625', finished(2, 1)]]));
  await ledger.save();

  const reloaded = new PredictionLedger({ filePath: ledger.filePath, logger: silentLogger });
  await reloaded.load();

  const summary = reloaded.summary();
  assert.equal(summary.wins, 1);
  assert.equal(summary.winRate, 100);
});

test('a missing ledger file loads as empty rather than throwing', async () => {
  const ledger = new PredictionLedger({
    filePath: path.join(os.tmpdir(), 'nexusbet-does-not-exist', 'ledger.json'),
    logger: silentLogger,
  });

  await ledger.load();
  assert.equal(ledger.summary().settledCount, 0);
});

test('cache serves the last good value when a refresh fails', async () => {
  const cache = new TtlCache();
  let call = 0;
  const producer = async () => {
    call += 1;
    if (call === 1) return 'fresh';
    throw new Error('upstream down');
  };

  const first = await cache.getOrSet('k', 0, producer);
  assert.equal(first.value, 'fresh');

  const second = await cache.getOrSet('k', 0, producer);
  assert.equal(second.value, 'fresh');
  assert.equal(second.stale, true);
});

test('cache collapses concurrent refreshes into one upstream call', async () => {
  const cache = new TtlCache();
  let calls = 0;
  const producer = async () => {
    calls += 1;
    await new Promise((r) => setTimeout(r, 10));
    return calls;
  };

  await Promise.all([
    cache.getOrSet('k', 1000, producer),
    cache.getOrSet('k', 1000, producer),
    cache.getOrSet('k', 1000, producer),
  ]);

  assert.equal(calls, 1);
});

test('cache throws when the first ever call fails', async () => {
  const cache = new TtlCache();
  await assert.rejects(() =>
    cache.getOrSet('k', 1000, async () => {
      throw new Error('cold failure');
    }),
  );
});
