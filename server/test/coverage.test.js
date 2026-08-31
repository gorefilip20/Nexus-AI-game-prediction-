'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createCoverage, classifyLeague, coverageDates, normaliseName } = require('../src/coverage');
const {
  runBacktest,
  actualOutcome,
  brierScore,
  buildThresholdTable,
  buildCalibration,
} = require('../src/backtest');
const { modelConfidence } = require('../src/board');

const silentLogger = { warn() {}, info() {}, error() {} };

const fixture = (league, leagueId = 39) => ({ sport: 'football', league, leagueId });

test('normaliseName strips the diacritics that break word matching', () => {
  assert.equal(normaliseName('Division 1 Féminine'), 'Division 1 Feminine');
  assert.equal(normaliseName('Première Ligue'), 'Premiere Ligue');
});

test("women's competitions are recognised across languages", () => {
  const womens = [
    "FA Women's Super League",
    'NWSL',
    'WNBA',
    'Liga F',
    'Serie A Femminile',
    'Frauen-Bundesliga',
    'Damallsvenskan',
    'Division 1 Féminine',
    'Campeonato Brasileiro Feminino',
    'Liga Femenina',
    "UEFA Women's Champions League",
    'Toppserien',
    'Ekstraliga Kobiet',
    'FIVB Womens Nations League',
    'Naisten Liiga',
  ];

  for (const name of womens) {
    assert.equal(classifyLeague(name).womens, true, `${name} should classify as women's`);
  }
});

test("men's competitions are not misclassified", () => {
  for (const name of ['Premier League', 'La Liga', 'Serie A', 'NBA', 'Bundesliga', 'Ligue 1', 'SuperLega', 'Eredivisie']) {
    assert.equal(classifyLeague(name).womens, false, `${name} must not classify as women's`);
  }
});

test('youth and friendly competitions are identified separately', () => {
  assert.equal(classifyLeague('Premier League U21').youth, true);
  assert.equal(classifyLeague('Primavera 1').youth, true);
  assert.equal(classifyLeague('UEFA Youth League').youth, true);
  assert.equal(classifyLeague('Club Friendlies').friendly, true);
  assert.equal(classifyLeague('Premier League').youth, false);
});

test("women's fixtures are included by default", () => {
  const coverage = createCoverage({ logger: silentLogger });

  assert.equal(coverage.includeLeague(fixture("FA Women's Super League")), true);
  assert.equal(coverage.includeLeague(fixture('WNBA')), true);
  assert.equal(coverage.includeLeague(fixture('Premier League')), true);
  assert.equal(coverage.snapshot().womens, 2);
});

test("excluding women's competitions has to be deliberate", () => {
  const coverage = createCoverage({ includeWomens: false, logger: silentLogger });

  assert.equal(coverage.includeLeague(fixture("FA Women's Super League")), false);
  assert.equal(coverage.includeLeague(fixture('Premier League')), true);
});

test('youth competitions are excluded by default, as books do', () => {
  const coverage = createCoverage({ logger: silentLogger });

  assert.equal(coverage.includeLeague(fixture('Premier League U21')), false);
  assert.equal(coverage.snapshot().excludedYouth, 1);

  const withYouth = createCoverage({ includeYouth: true, logger: silentLogger });
  assert.equal(withYouth.includeLeague(fixture('Premier League U21')), true);
});

test('an allow list restricts coverage to named leagues', () => {
  const coverage = createCoverage({ leagueAllowList: ['39', '140'], logger: silentLogger });

  assert.equal(coverage.includeLeague(fixture('Premier League', 39)), true);
  assert.equal(coverage.includeLeague(fixture('La Liga', 140)), true);
  assert.equal(coverage.includeLeague(fixture('Serie A', 135)), false);
});

test('a block list removes specific leagues', () => {
  const coverage = createCoverage({ leagueBlockList: ['667'], logger: silentLogger });
  assert.equal(coverage.includeLeague(fixture('Club Friendlies', 667)), false);
  assert.equal(coverage.includeLeague(fixture('Premier League', 39)), true);
});

test('coverageDates walks forward and is capped at a week', () => {
  const from = new Date('2026-09-01T12:00:00Z');
  assert.deepEqual(coverageDates(from, 3), ['2026-09-01', '2026-09-02', '2026-09-03']);
  assert.equal(coverageDates(from, 1).length, 1);
  assert.equal(coverageDates(from, 99).length, 7);
});

test('actualOutcome reads the result from the score', () => {
  assert.equal(actualOutcome({ homeScore: 2, awayScore: 1 }), 'home');
  assert.equal(actualOutcome({ homeScore: 0, awayScore: 3 }), 'away');
  assert.equal(actualOutcome({ homeScore: 1, awayScore: 1 }), 'draw');
  assert.equal(actualOutcome({ homeScore: null, awayScore: 1 }), null);
});

test('the Brier score rewards confident correctness and punishes confident error', () => {
  const certainRight = brierScore({ home: 1, draw: 0, away: 0 }, 'home');
  const certainWrong = brierScore({ home: 1, draw: 0, away: 0 }, 'away');
  const hedged = brierScore({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 }, 'home');

  assert.equal(certainRight, 0);
  assert.equal(certainWrong, 2);
  assert.ok(hedged > certainRight && hedged < certainWrong);
});

test('the threshold table tightens as confidence rises', () => {
  const predictions = [
    { confidence: 0.95, correct: true },
    { confidence: 0.85, correct: true },
    { confidence: 0.75, correct: true },
    { confidence: 0.55, correct: false },
    { confidence: 0.45, correct: false },
  ];

  const table = buildThresholdTable(predictions, [0.4, 0.7, 0.9]);

  assert.equal(table[0].picks, 5);
  assert.equal(table[0].strikeRate, 60);
  assert.equal(table[1].picks, 3);
  assert.equal(table[1].strikeRate, 100);
  assert.equal(table[2].picks, 1);
});

test('a threshold nothing reaches reports null rather than a fake rate', () => {
  const table = buildThresholdTable([{ confidence: 0.5, correct: true }], [0.9]);
  assert.equal(table[0].picks, 0);
  assert.equal(table[0].strikeRate, null);
});

test('calibration exposes overconfidence', () => {
  // Claims 90%, delivers 50%.
  const predictions = [
    { confidence: 0.9, correct: true },
    { confidence: 0.9, correct: false },
  ];

  const bins = buildCalibration(predictions);
  const bin = bins.find((b) => b.picks === 2);
  assert.equal(bin.observed, 50);
  assert.equal(bin.meanPredicted, 90);
  assert.equal(bin.overconfidencePoints, 40);
});

test('a backtest refuses to score a league with too little history', () => {
  const thin = Array.from({ length: 20 }, (_, i) => ({
    home: 'A', away: 'B', homeScore: 1, awayScore: 0,
    kickoff: `2026-01-${String(i + 1).padStart(2, '0')}T12:00:00Z`,
    status: { finished: true },
  }));

  const result = runBacktest('football', thin, { minTrain: 60 });
  assert.equal(result.ok, false);
  assert.match(result.reason, /at least/);
});

test('a backtest scores only fixtures the model never trained on', () => {
  // A league with a clear pecking order, so the model has signal to find.
  const teams = ['A', 'B', 'C', 'D', 'E', 'F'];
  const strength = { A: 3, B: 2, C: 2, D: 1, E: 1, F: 0 };
  const fixtures = [];
  let day = 0;

  for (let round = 0; round < 10; round += 1) {
    for (const home of teams) {
      for (const away of teams) {
        if (home === away) continue;
        day += 1;
        fixtures.push({
          sport: 'football',
          home,
          away,
          homeScore: strength[home],
          awayScore: strength[away],
          kickoff: new Date(Date.UTC(2026, 0, 1) + day * 3_600_000).toISOString(),
          status: { finished: true },
        });
      }
    }
  }

  const result = runBacktest('football', fixtures, { folds: 3, minTrain: 100 });

  assert.equal(result.ok, true);
  assert.ok(result.predictionsScored > 0);
  assert.ok(result.predictionsScored < result.fixturesAvailable, 'training fixtures are not scored');
  assert.ok(result.accuracy >= 0 && result.accuracy <= 100);
  assert.ok(result.byThreshold.length > 0);
  assert.ok(result.calibration.length > 0);
});

test('modelConfidence reads the strongest outcome', () => {
  assert.equal(modelConfidence({ outcome: { home: 58.2, draw: 22.9, away: 19 } }), 58.2);
  assert.equal(modelConfidence({ outcome: { home: 20, draw: 15, away: 65 } }), 65);
  assert.equal(modelConfidence(null), null);
  assert.equal(modelConfidence({}), null);
});
