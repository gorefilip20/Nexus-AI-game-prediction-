'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { encodeSlip, decodeSlip, checksum } = require('../src/slip');
const { runScenario, teamMatches } = require('../src/scenario');
const { buildBoard } = require('../src/board');

const finishedFixture = (home, away, homeScore, awayScore, sport = 'football') => ({
  sport,
  id: Math.floor(Math.random() * 1e6),
  leagueId: 39,
  league: 'Premier League',
  season: 2026,
  home,
  away,
  homeScore,
  awayScore,
  kickoff: '2026-08-01T14:00:00+00:00',
  status: { short: 'FT', long: 'Match Finished', finished: true, notStarted: false },
});

const upcomingFixture = (overrides = {}) => ({
  sport: 'football',
  id: 900001,
  leagueId: 39,
  league: 'Premier League',
  season: 2026,
  home: 'Chelsea',
  away: 'Brighton & Hove Albion',
  kickoff: '2026-08-30T14:00:00+00:00',
  timestamp: 1788444000,
  homeScore: null,
  awayScore: null,
  status: { short: 'NS', long: 'Not Started', finished: false, notStarted: true },
  ...overrides,
});

/** Builds a league history strong enough to fit, with a known pecking order. */
function leagueHistory() {
  const rows = [];
  const strengths = {
    Chelsea: 2.0,
    'Brighton & Hove Albion': 1.2,
    Arsenal: 1.9,
    Everton: 1.0,
    Fulham: 1.1,
  };
  const teams = Object.keys(strengths);

  for (let round = 0; round < 8; round += 1) {
    for (const home of teams) {
      for (const away of teams) {
        if (home === away) continue;
        rows.push(
          finishedFixture(
            home,
            away,
            Math.round(strengths[home] * 1.15),
            Math.round(strengths[away] * 0.85),
          ),
        );
      }
    }
  }
  return rows;
}

function stubProvider({ schedule = {}, history = [], slips = [] } = {}) {
  return {
    name: 'stub',
    live: true,
    sports: ['football', 'basketball', 'volleyball'],
    async listFixturesByDate(sport) {
      const entry = schedule[sport];
      if (entry instanceof Error) throw entry;
      return entry ?? [];
    },
    async getHistory() {
      return history;
    },
    async getSlips() {
      return {
        provider: 'stub',
        live: true,
        fetchedAt: '2026-08-30T12:00:00.000Z',
        quota: {},
        degraded: [],
        slips,
      };
    },
    getQuota: () => ({}),
  };
}

test('checksum changes when the body changes', () => {
  assert.notEqual(checksum('NB1-FB-1-1X2-H'), checksum('NB1-FB-2-1X2-H'));
  assert.equal(checksum('NB1-FB-1-1X2-H'), checksum('NB1-FB-1-1X2-H'));
});

test('a slip code round-trips to the same selection', () => {
  const code = encodeSlip({ id: 239625, sport: 'football', pickLabel: 'Home' });
  const decoded = decodeSlip(code);

  assert.equal(decoded.valid, true);
  assert.equal(decoded.sport, 'football');
  assert.equal(decoded.fixtureId, 239625);
  assert.equal(decoded.selection, 'Home');
});

test('every supported sport encodes and decodes', () => {
  for (const [sport, pick] of [
    ['football', 'Draw'],
    ['basketball', 'Away'],
    ['volleyball', 'Home'],
  ]) {
    const decoded = decodeSlip(encodeSlip({ id: 11, sport, pickLabel: pick }));
    assert.equal(decoded.valid, true, `${sport} should round-trip`);
    assert.equal(decoded.sport, sport);
    assert.equal(decoded.selection, pick);
  }
});

test('a tampered slip code fails its checksum', () => {
  const code = encodeSlip({ id: 239625, sport: 'football', pickLabel: 'Home' });
  const tampered = code.replace('239625', '239626');

  assert.equal(decodeSlip(tampered).valid, false);
  assert.match(decodeSlip(tampered).reason, /checksum/);
});

test('foreign or malformed codes are rejected, not guessed at', () => {
  assert.equal(decodeSlip('STK-ARS-77X').valid, false);
  assert.equal(decodeSlip('NB1-FB-1').valid, false);
  assert.equal(decodeSlip('').valid, false);
  assert.equal(decodeSlip(null).valid, false);
  assert.equal(decodeSlip('NB1-XX-1-1X2-H-00').valid, false);
});

test('the model overrides the market favourite in the slip code', () => {
  const slip = { id: 500, sport: 'football', pickLabel: 'Home' };
  const code = encodeSlip(slip, { outcome: { home: 20, draw: 15, away: 65 } });
  assert.equal(decodeSlip(code).selection, 'Away');
});

test('a slip with no selection at all produces no code', () => {
  assert.equal(encodeSlip({ id: 1, sport: 'football', pickLabel: null }), null);
  assert.equal(encodeSlip({ sport: 'football', pickLabel: 'Home' }), null);
  assert.equal(encodeSlip({ id: 1, sport: 'cricket', pickLabel: 'Home' }), null);
});

test('teamMatches handles partial club names', () => {
  assert.ok(teamMatches('Brighton & Hove Albion', 'Brighton'));
  assert.ok(teamMatches('Chelsea', 'chelsea'));
  assert.ok(teamMatches('Manchester City', 'Man City') === false, 'abbreviations are not expanded');
  assert.ok(!teamMatches('Arsenal', 'Chelsea'));
  assert.ok(!teamMatches('', 'Chelsea'));
});

test('the Chelsea vs Brighton scenario prices a scheduled fixture', async () => {
  const provider = stubProvider({
    schedule: { football: [upcomingFixture()] },
    history: leagueHistory(),
  });

  const result = await runScenario({
    provider,
    home: 'Chelsea',
    away: 'Brighton',
    date: '2026-08-30',
  });

  assert.equal(result.status, 'ok');
  assert.equal(result.fixture.home, 'Chelsea');
  assert.equal(result.markets.model, 'poisson');
  assert.ok(result.historyCount > 0);

  const { home, draw, away } = result.markets.outcome;
  assert.ok(Math.abs(home + draw + away - 100) < 0.2, 'percentages should sum to 100');
  assert.ok(home > away, 'the stronger side should be favoured');
  assert.equal(decodeSlip(result.slipCode).valid, true);
});

test('the scenario reports a fixture that is not scheduled instead of inventing one', async () => {
  const provider = stubProvider({
    schedule: { football: [upcomingFixture({ home: 'Arsenal', away: 'Everton' })] },
    history: leagueHistory(),
  });

  const result = await runScenario({
    provider,
    home: 'Chelsea',
    away: 'Brighton',
    date: '2026-08-30',
  });

  assert.equal(result.status, 'not_scheduled');
  assert.equal(result.markets, undefined);
  assert.equal(result.scanned.length, 1);
});

test('the scenario refuses to price a league with no finished matches', async () => {
  const provider = stubProvider({ schedule: { football: [upcomingFixture()] }, history: [] });

  const result = await runScenario({ provider, home: 'Chelsea', away: 'Brighton' });
  assert.equal(result.status, 'no_history');
  assert.equal(result.markets, undefined);
});

test('the scenario refuses to rate a team it has never seen', async () => {
  const provider = stubProvider({
    schedule: { football: [upcomingFixture({ home: 'Chelsea', away: 'Newly Promoted FC' })] },
    history: leagueHistory(),
  });

  const result = await runScenario({ provider, home: 'Chelsea', away: 'Newly Promoted' });
  assert.equal(result.status, 'unrated_team');
});

test('a failing sport schedule does not abort the search', async () => {
  const provider = stubProvider({
    schedule: {
      football: new Error('football feed down'),
      basketball: [upcomingFixture({ sport: 'basketball', home: 'Lakers', away: 'Celtics' })],
    },
    history: leagueHistory(),
  });

  const result = await runScenario({ provider, home: 'Chelsea', away: 'Brighton' });
  assert.equal(result.status, 'not_scheduled');
  assert.ok(result.scheduleErrors.some((e) => e.sport === 'football'));
});

test('reversed home and away still finds the fixture', async () => {
  const provider = stubProvider({
    schedule: { football: [upcomingFixture()] },
    history: leagueHistory(),
  });

  const result = await runScenario({ provider, home: 'Brighton', away: 'Chelsea' });
  assert.equal(result.status, 'ok');
});

test('buildBoard attaches model probabilities and slip codes', async () => {
  const provider = stubProvider({
    history: leagueHistory(),
    slips: [
      {
        ...upcomingFixture(),
        ref: 'NB-FO-900001',
        pickLabel: 'Home',
        probability: 55,
        oddsAvailable: true,
      },
    ],
  });

  const board = await buildBoard({ provider, logger: { warn() {} } });
  assert.equal(board.modelEnabled, true);
  assert.equal(board.slips.length, 1);
  assert.ok(board.slips[0].model, 'the slip should carry model output');
  assert.equal(board.slips[0].model.model, 'poisson');
  assert.equal(decodeSlip(board.slips[0].slipCode).valid, true);
});

test('buildBoard still returns slips when the model is disabled', async () => {
  const provider = stubProvider({
    history: leagueHistory(),
    slips: [{ ...upcomingFixture(), pickLabel: 'Home', oddsAvailable: true }],
  });

  const board = await buildBoard({ provider, modelEnabled: false, logger: { warn() {} } });
  assert.equal(board.modelEnabled, false);
  assert.equal(board.slips[0].model, null);
  assert.ok(board.slips[0].slipCode, 'a market-only slip still gets a code');
});

test('buildBoard notes a league it could not fit rather than failing', async () => {
  const provider = {
    ...stubProvider({ slips: [{ ...upcomingFixture(), pickLabel: 'Home', oddsAvailable: true }] }),
    async getHistory() {
      return [];
    },
  };

  const board = await buildBoard({ provider, logger: { warn() {} } });
  assert.equal(board.slips[0].model, null);
  assert.ok(board.modelNotes.some((n) => /no finished fixtures/.test(n.note)));
});
