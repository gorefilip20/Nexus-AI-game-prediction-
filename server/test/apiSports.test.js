'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  createApiSportsProvider,
  normaliseFootball,
  normaliseFlatGame,
  extractMoneyline,
  readScore,
  normaliseStatus,
} = require('../src/providers/apiSports');
const { TtlCache } = require('../src/cache');
const { assertNoApiErrors, getJson, ProviderError } = require('../src/http');

const load = (name) =>
  JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8'));

const football = load('football-fixtures.json');
const basketball = load('basketball-games.json');
const volleyball = load('volleyball-games.json');
const odds = load('odds.json');
const quotaError = load('error-quota.json');

const silentLogger = { info() {}, warn() {}, error() {} };

/** Routes stubbed responses by URL so one fake serves all three sport hosts. */
function stubFetch(routes) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const match = Object.entries(routes).find(([pattern]) => url.includes(pattern));
    if (!match) throw new Error(`Unexpected request: ${url}`);
    const body = match[1];
    if (body instanceof Error) throw body;
    return {
      ok: true,
      status: 200,
      json: async () => body,
      headers: { get: (name) => (name === 'x-ratelimit-requests-remaining' ? '87' : null) },
    };
  };
  return { fetchImpl, calls };
}

function makeProvider(routes, overrides = {}) {
  const { fetchImpl, calls } = stubFetch(routes);
  const provider = createApiSportsProvider({
    key: 'test-key',
    cache: new TtlCache(),
    fetchImpl,
    logger: silentLogger,
    fixturesPerSport: 3,
    ...overrides,
  });
  return { provider, calls };
}

const ALL_ROUTES = {
  'v3.football.api-sports.io/fixtures': football,
  'v1.basketball.api-sports.io/games': basketball,
  'v1.volleyball.api-sports.io/games': volleyball,
  '/odds': odds,
};

test('football fixtures normalise into the common shape', () => {
  const fixture = normaliseFootball(football.response[0]);
  assert.equal(fixture.sport, 'football');
  assert.equal(fixture.id, 239625);
  assert.equal(fixture.league, 'Premier League');
  assert.equal(fixture.country, 'England');
  assert.equal(fixture.home, 'Arsenal');
  assert.equal(fixture.away, 'Chelsea');
  assert.equal(fixture.status.short, 'NS');
  assert.equal(fixture.status.finished, false);
  assert.equal(fixture.homeScore, null);
});

test('a finished football fixture carries its score and finished flag', () => {
  const fixture = normaliseFootball(football.response[1]);
  assert.equal(fixture.status.finished, true);
  assert.equal(fixture.homeScore, 2);
  assert.equal(fixture.awayScore, 1);
});

test('basketball games normalise from the flat v1 shape', () => {
  const game = normaliseFlatGame('basketball')(basketball.response[0]);
  assert.equal(game.sport, 'basketball');
  assert.equal(game.id, 358901);
  assert.equal(game.league, 'NBA');
  assert.equal(game.country, 'USA');
  assert.equal(game.home, 'LA Lakers');
  assert.equal(game.away, 'Boston Celtics');
});

test('volleyball games normalise despite a different score encoding', () => {
  const game = normaliseFlatGame('volleyball')(volleyball.response[0]);
  assert.equal(game.sport, 'volleyball');
  assert.equal(game.league, 'FIVB Nations League');
  assert.equal(game.home, 'Italy');
  assert.equal(game.away, 'Brazil');
});

test('readScore accepts both the nested total and a bare set count', () => {
  assert.equal(readScore({ total: 112 }), 112);
  assert.equal(readScore(3), 3);
  assert.equal(readScore('2'), 2);
  assert.equal(readScore(null), null);
  assert.equal(readScore({ total: null }), null);
});

test('normaliseStatus recognises finished and not-started codes', () => {
  assert.equal(normaliseStatus({ short: 'FT' }).finished, true);
  assert.equal(normaliseStatus({ short: 'AOT' }).finished, true);
  assert.equal(normaliseStatus({ short: 'NS' }).notStarted, true);
  assert.equal(normaliseStatus({ short: 'HT' }).finished, false);
});

test('extractMoneyline skips other markets and returns labelled outcomes', () => {
  const market = extractMoneyline(odds.response[0]);
  assert.equal(market.bookmaker, 'Bwin');
  assert.equal(market.market, 'Match Winner');
  assert.deepEqual(
    market.outcomes.map((o) => o.label),
    ['Home', 'Draw', 'Away'],
  );
});

test('extractMoneyline returns null when no recognisable market exists', () => {
  assert.equal(
    extractMoneyline({ bookmakers: [{ name: 'X', bets: [{ name: 'Corners', values: [] }] }] }),
    null,
  );
  assert.equal(extractMoneyline(undefined), null);
});

test('getSlips returns priced slips across all three sports', async () => {
  const { provider } = makeProvider(ALL_ROUTES);
  const board = await provider.getSlips();

  assert.equal(board.live, true);
  assert.equal(board.provider, 'api-sports');
  assert.deepEqual(
    [...new Set(board.slips.map((s) => s.sport))].sort(),
    ['basketball', 'football', 'volleyball'],
  );

  const arsenal = board.slips.find((s) => s.id === 239625);
  assert.equal(arsenal.prediction, 'Arsenal to Win');
  assert.equal(arsenal.pickLabel, 'Home');
  assert.equal(arsenal.oddsAvailable, true);
  assert.equal(arsenal.odd, 1.9);
  assert.equal(arsenal.bookmaker, 'Bwin');
  assert.equal(arsenal.ref, 'NB-FO-239625');
  assert.ok(arsenal.probability > 47 && arsenal.probability < 52);
});

test('finished fixtures are filtered off the upcoming board', async () => {
  const { provider } = makeProvider(ALL_ROUTES);
  const board = await provider.getSlips();
  assert.equal(
    board.slips.find((s) => s.id === 239626),
    undefined,
  );
});

test('a fixture without odds still reaches the board, unpriced', async () => {
  const { provider } = makeProvider({ ...ALL_ROUTES, '/odds': { response: [] } });
  const board = await provider.getSlips();

  assert.ok(board.slips.length > 0);
  for (const slip of board.slips) {
    assert.equal(slip.oddsAvailable, false);
    assert.equal(slip.prediction, null);
    assert.equal(slip.probability, null);
  }
});

test('one failing sport degrades that sport without emptying the board', async () => {
  const { provider } = makeProvider({
    ...ALL_ROUTES,
    'v1.volleyball.api-sports.io/games': new Error('upstream exploded'),
  });

  const board = await provider.getSlips();
  assert.ok(board.slips.some((s) => s.sport === 'football'));
  assert.ok(board.degraded.some((d) => d.sport === 'volleyball'));
});

test('quota headers are captured for the meta endpoint', async () => {
  const { provider } = makeProvider(ALL_ROUTES);
  await provider.getSlips();
  assert.equal(provider.getQuota().football.remaining, 87);
});

test('repeat calls inside the TTL are served from cache', async () => {
  const { provider, calls } = makeProvider(ALL_ROUTES);
  await provider.getSlips();
  const afterFirst = calls.length;
  await provider.getSlips();
  assert.equal(calls.length, afterFirst, 'second load should not hit the network');
});

test('an HTTP 200 carrying an errors object is treated as a failure', () => {
  assert.throws(() => assertNoApiErrors(quotaError), ProviderError);
  assert.doesNotThrow(() => assertNoApiErrors({ errors: [], response: [] }));
  assert.doesNotThrow(() => assertNoApiErrors({ response: [] }));
});

test('getJson surfaces a non-retryable HTTP error without retrying', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    return { ok: false, status: 401, json: async () => ({}), headers: { get: () => null } };
  };

  await assert.rejects(
    () => getJson('https://example.test/x', { fetchImpl, retries: 2, logger: silentLogger }),
    (err) => err instanceof ProviderError && err.status === 401,
  );
  assert.equal(attempts, 1, 'a 401 must not be retried');
});

test('getResults only returns fixtures that actually finished', async () => {
  const { provider } = makeProvider({
    'v3.football.api-sports.io/fixtures': { response: [football.response[1]] },
  });

  const results = await provider.getResults([{ sport: 'football', id: 239626 }]);
  const fixture = results.get('football:239626');
  assert.ok(fixture);
  assert.equal(fixture.homeScore, 2);
  assert.equal(fixture.awayScore, 1);
});
