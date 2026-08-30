'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { searchFixtures } = require('../src/search');

const upcoming = (overrides = {}) => ({
  sport: 'football',
  id: 900001,
  leagueId: 39,
  league: 'Premier League',
  season: 2026,
  home: 'Chelsea',
  away: 'Brighton & Hove Albion',
  kickoff: '2026-09-05T14:00:00Z',
  timestamp: 1788876000,
  homeScore: null,
  awayScore: null,
  status: { short: 'NS', long: 'Not Started', finished: false, notStarted: true },
  ...overrides,
});

const finishedFixture = (home, away, hs, as, kickoff) => ({
  ...upcoming({ home, away, homeScore: hs, awayScore: as, kickoff }),
  id: `${home}-${away}-${kickoff}`,
  status: { short: 'FT', long: 'Match Finished', finished: true, notStarted: false },
});

function leagueHistory() {
  const rows = [];
  const power = { Chelsea: 2, 'Brighton & Hove Albion': 1, Everton: 1, Fulham: 1 };
  const teams = Object.keys(power);
  let day = 1;
  for (let r = 0; r < 8; r += 1) {
    for (const h of teams) {
      for (const a of teams) {
        if (h === a) continue;
        day += 1;
        rows.push(
          finishedFixture(
            h,
            a,
            power[h] + 1,
            power[a] - 1,
            new Date(Date.UTC(2026, 5, 1) + day * 86400000).toISOString(),
          ),
        );
      }
    }
  }
  return rows;
}

/** Stub provider whose schedule is keyed by `${sport}:${date}`. */
function stubProvider({ schedule = {}, history = [], failOn = [] } = {}) {
  const calls = { schedule: [], price: 0, history: 0 };

  return {
    name: 'stub',
    live: true,
    sports: ['football', 'basketball', 'volleyball'],
    calls,
    async listFixturesByDate(sport, date) {
      calls.schedule.push(`${sport}:${date}`);
      if (failOn.includes(sport)) throw new Error(`${sport} feed down`);
      return schedule[`${sport}:${date}`] ?? schedule[sport] ?? [];
    },
    async priceFixtures(fixtures) {
      calls.price += 1;
      return fixtures.map((f) => ({
        ...f,
        oddsAvailable: true,
        pickLabel: 'Home',
        probability: 50.5,
        odd: 1.9,
        bookmaker: 'Bwin',
        marketOutcomes: [
          { label: 'Home', odd: 1.9, impliedProbability: 50.5 },
          { label: 'Draw', odd: 3.6, impliedProbability: 26.6 },
          { label: 'Away', odd: 4.2, impliedProbability: 22.9 },
        ],
      }));
    },
    async getHistory() {
      calls.history += 1;
      return history;
    },
    async getSlips() {
      return { provider: 'stub', live: true, fetchedAt: '', quota: {}, degraded: [], slips: [] };
    },
    getQuota: () => ({}),
  };
}

const NOW = () => new Date('2026-09-05T09:00:00Z');

test('a team search returns the scheduled fixture, priced and analysed', async () => {
  const provider = stubProvider({
    schedule: { 'football:2026-09-05': [upcoming()] },
    history: leagueHistory(),
  });

  const result = await searchFixtures({
    provider,
    query: 'Brighton',
    now: NOW,
    logger: { warn() {} },
  });

  assert.equal(result.results.length, 1);
  const slip = result.results[0];
  assert.equal(slip.home, 'Chelsea');
  assert.ok(slip.oddsAvailable, 'search results must be priced');
  assert.ok(slip.model, 'search results must carry model output');
  assert.ok(slip.matchJustification, 'search results must carry a justification');
  assert.ok(slip.slipCode, 'search results must carry a slip code');
});

test('a partial name finds the full club name', async () => {
  const provider = stubProvider({
    schedule: { 'football:2026-09-05': [upcoming()] },
    history: leagueHistory(),
  });

  for (const query of ['Brighton', 'chelsea', 'Premier League']) {
    const result = await searchFixtures({ provider, query, now: NOW, logger: { warn() {} } });
    assert.equal(result.results.length, 1, `"${query}" should match`);
  }
});

test('a query that matches nothing returns an empty result, not an error', async () => {
  const provider = stubProvider({
    schedule: { 'football:2026-09-05': [upcoming()] },
    history: leagueHistory(),
  });

  const result = await searchFixtures({ provider, query: 'Barcelona', now: NOW, logger: { warn() {} } });
  assert.deepEqual(result.results, []);
  assert.ok(result.scanned > 0, 'it should report that it did look');
});

test('a too-short query is rejected before any upstream call', async () => {
  const provider = stubProvider({});
  const result = await searchFixtures({ provider, query: 'B', now: NOW });

  assert.equal(result.reason, 'query too short');
  assert.equal(provider.calls.schedule.length, 0, 'no requests should be spent');
});

test('the sport filter narrows which schedules are fetched', async () => {
  const provider = stubProvider({
    schedule: { 'football:2026-09-05': [upcoming()] },
    history: leagueHistory(),
  });

  await searchFixtures({ provider, query: 'Chelsea', sport: 'basketball', days: 1, now: NOW, logger: { warn() {} } });
  assert.deepEqual(provider.calls.schedule, ['basketball:2026-09-05']);
});

test('an unknown sport filter falls back to scanning every sport', async () => {
  const provider = stubProvider({ schedule: {}, history: [] });
  await searchFixtures({ provider, query: 'Chelsea', sport: 'cricket', days: 1, now: NOW, logger: { warn() {} } });

  assert.equal(provider.calls.schedule.length, 3);
});

test('the search scans forward across days', async () => {
  const provider = stubProvider({
    schedule: { 'football:2026-09-07': [upcoming({ kickoff: '2026-09-07T14:00:00Z' })] },
    history: leagueHistory(),
  });

  const result = await searchFixtures({
    provider,
    query: 'Brighton',
    days: 3,
    sport: 'football',
    now: NOW,
    logger: { warn() {} },
  });

  assert.equal(result.results.length, 1);
  assert.equal(result.daysScanned, 3);
});

test('days is capped so a wide query cannot burn the quota', async () => {
  const provider = stubProvider({ schedule: {}, history: [] });
  const result = await searchFixtures({
    provider,
    query: 'Chelsea',
    days: 99,
    sport: 'football',
    now: NOW,
    logger: { warn() {} },
  });

  assert.equal(result.daysScanned, 7);
  assert.equal(provider.calls.schedule.length, 7);
});

test('the same fixture appearing on two scanned days is returned once', async () => {
  const duplicate = upcoming();
  const provider = stubProvider({
    schedule: {
      'football:2026-09-05': [duplicate],
      'football:2026-09-06': [duplicate],
    },
    history: leagueHistory(),
  });

  const result = await searchFixtures({
    provider,
    query: 'Brighton',
    days: 2,
    sport: 'football',
    now: NOW,
    logger: { warn() {} },
  });

  assert.equal(result.results.length, 1);
});

test('finished fixtures are excluded unless asked for', async () => {
  const played = { ...upcoming(), status: { short: 'FT', finished: true, notStarted: false } };
  const provider = stubProvider({
    schedule: { 'football:2026-09-05': [played] },
    history: leagueHistory(),
  });

  const hidden = await searchFixtures({ provider, query: 'Brighton', sport: 'football', days: 1, now: NOW, logger: { warn() {} } });
  assert.equal(hidden.results.length, 0);

  const shown = await searchFixtures({
    provider,
    query: 'Brighton',
    sport: 'football',
    days: 1,
    includeFinished: true,
    now: NOW,
    logger: { warn() {} },
  });
  assert.equal(shown.results.length, 1);
});

test('one failing sport does not abort the whole search', async () => {
  const provider = stubProvider({
    schedule: { 'football:2026-09-05': [upcoming()] },
    history: leagueHistory(),
    failOn: ['volleyball'],
  });

  const result = await searchFixtures({ provider, query: 'Brighton', days: 1, now: NOW, logger: { warn() {} } });

  assert.equal(result.results.length, 1);
  assert.ok(result.errors.some((e) => e.sport === 'volleyball'));
});

test('results are capped and the truncation reported', async () => {
  const many = Array.from({ length: 20 }, (_, i) =>
    upcoming({ id: 1000 + i, timestamp: 1788876000 + i * 3600 }),
  );
  const provider = stubProvider({
    schedule: { 'football:2026-09-05': many },
    history: leagueHistory(),
  });

  const result = await searchFixtures({
    provider,
    query: 'Brighton',
    sport: 'football',
    days: 1,
    limit: 5,
    now: NOW,
    logger: { warn() {} },
  });

  assert.equal(result.results.length, 5);
  assert.equal(result.matched, 20);
  assert.equal(result.truncated, true);
});

test('results are ordered by kickoff', async () => {
  const provider = stubProvider({
    schedule: {
      'football:2026-09-05': [
        upcoming({ id: 2, timestamp: 2000, kickoff: '2026-09-05T20:00:00Z' }),
        upcoming({ id: 1, timestamp: 1000, kickoff: '2026-09-05T12:00:00Z' }),
      ],
    },
    history: leagueHistory(),
  });

  const result = await searchFixtures({ provider, query: 'Brighton', sport: 'football', days: 1, now: NOW, logger: { warn() {} } });
  assert.deepEqual(result.results.map((r) => r.id), [1, 2]);
});

test('search works without a model when the engine is disabled', async () => {
  const provider = stubProvider({
    schedule: { 'football:2026-09-05': [upcoming()] },
    history: leagueHistory(),
  });

  const result = await searchFixtures({
    provider,
    query: 'Brighton',
    sport: 'football',
    days: 1,
    modelEnabled: false,
    now: NOW,
    logger: { warn() {} },
  });

  assert.equal(result.modelEnabled, false);
  assert.equal(result.results[0].model, null);
  assert.ok(result.results[0].matchJustification, 'a justification is still generated');
  assert.equal(provider.calls.history, 0, 'no history should be fetched');
});
