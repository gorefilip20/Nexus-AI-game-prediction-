'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  poissonPmf,
  scoreMatrix,
  outcomeProbabilities,
  totalsProbabilities,
  handicapProbabilities,
  buildFootballMarkets,
} = require('../src/models/poisson');
const { fitPoissonRegression, fitDixonColesRho } = require('../src/models/regression');
const { normalCdf, fitLinearRatings, buildBasketballMarkets } = require('../src/models/normal');
const { binomial, setScoreDistribution, buildVolleyballMarkets, fitSetRatings } = require('../src/models/sets');
const { fitModel, summariseMarkets } = require('../src/models');

const close = (actual, expected, tolerance, label) =>
  assert.ok(
    Math.abs(actual - expected) < tolerance,
    `${label ?? 'value'}: expected ~${expected}, got ${actual}`,
  );

/** Deterministic Poisson sampler so model tests never flake. */
function makeSampler(seed = 12345) {
  let state = seed;
  const rand = () => {
    state = (state * 48271) % 2147483647;
    return state / 2147483647;
  };
  return (lambda) => {
    const limit = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k += 1;
      p *= rand();
    } while (p > limit);
    return k - 1;
  };
}

test('poissonPmf matches known values', () => {
  close(poissonPmf(0, 1), Math.exp(-1), 1e-12, 'P(0|1)');
  close(poissonPmf(2, 2), 2 * Math.exp(-2), 1e-12, 'P(2|2)');
  assert.equal(poissonPmf(-1, 2), 0);
  assert.equal(poissonPmf(0, 0), 1);
});

test('the score matrix is a proper probability distribution', () => {
  for (const rho of [0, -0.05, 0.05]) {
    const matrix = scoreMatrix(1.7, 1.2, { rho });
    const total = matrix.flat().reduce((a, b) => a + b, 0);
    close(total, 1, 1e-9, `matrix sums with rho=${rho}`);
    assert.ok(matrix.flat().every((p) => p >= 0));
  }
});

test('1X2 probabilities sum to one and favour the stronger side', () => {
  const outcome = outcomeProbabilities(scoreMatrix(2.1, 0.9));
  close(outcome.home + outcome.draw + outcome.away, 1, 1e-9, 'sum');
  assert.ok(outcome.home > outcome.away);
});

test('equal rates give a symmetric market', () => {
  const outcome = outcomeProbabilities(scoreMatrix(1.4, 1.4));
  close(outcome.home, outcome.away, 1e-9, 'symmetry');
});

test('over/under and handicap legs each sum to one with the push', () => {
  const matrix = scoreMatrix(1.6, 1.3);

  const halfLine = totalsProbabilities(matrix, 2.5);
  close(halfLine.over + halfLine.under, 1, 1e-9, 'half-line totals');
  assert.equal(halfLine.push, 0);

  const wholeLine = totalsProbabilities(matrix, 3);
  close(wholeLine.over + wholeLine.under + wholeLine.push, 1, 1e-9, 'whole-line totals');
  assert.ok(wholeLine.push > 0, 'a whole goal line must be able to push');

  const handicap = handicapProbabilities(matrix, -1);
  close(handicap.home + handicap.away + handicap.push, 1, 1e-9, 'handicap legs');
  assert.ok(handicap.push > 0);
});

test('a bigger handicap is harder to cover', () => {
  const matrix = scoreMatrix(2, 1);
  const easy = handicapProbabilities(matrix, -0.5).home;
  const hard = handicapProbabilities(matrix, -1.5).home;
  assert.ok(hard < easy, 'covering -1.5 must be less likely than -0.5');
});

test('higher goal expectancy raises the over', () => {
  const low = totalsProbabilities(scoreMatrix(0.9, 0.8), 2.5).over;
  const high = totalsProbabilities(scoreMatrix(2.2, 1.9), 2.5).over;
  assert.ok(high > low);
});

test('a negative rho shifts mass toward the draw', () => {
  const independent = outcomeProbabilities(scoreMatrix(1.3, 1.2, { rho: 0 }));
  const adjusted = outcomeProbabilities(scoreMatrix(1.3, 1.2, { rho: -0.1 }));
  assert.ok(adjusted.draw > independent.draw);
});

test('the football market set is internally consistent', () => {
  const markets = buildFootballMarkets(1.8, 1.1, { rho: -0.03 });
  close(
    markets.outcome.home + markets.outcome.draw + markets.outcome.away,
    1,
    1e-9,
    '1X2 sum',
  );
  close(markets.btts.yes + markets.btts.no, 1, 1e-9, 'btts sum');
  assert.equal(markets.totals.length, 3);
  assert.equal(markets.handicaps.length, 4);
  assert.equal(markets.scorelines.length, 5);
});

test('poisson regression recovers known team strengths', () => {
  const sample = makeSampler();
  const teams = ['A', 'B', 'C', 'D', 'E', 'F'];
  const attack = { A: 0.45, B: 0.25, C: 0, D: -0.1, E: -0.25, F: -0.35 };
  const defence = { A: 0.3, B: 0.1, C: 0, D: -0.05, E: -0.15, F: -0.2 };
  const mu = Math.log(1.35);
  const homeEdge = 0.26;

  const matches = [];
  for (let round = 0; round < 16; round += 1) {
    for (const home of teams) {
      for (const away of teams) {
        if (home === away) continue;
        matches.push({
          home,
          away,
          homeScore: sample(Math.exp(mu + attack[home] - defence[away] + homeEdge)),
          awayScore: sample(Math.exp(mu + attack[away] - defence[home])),
        });
      }
    }
  }

  const fit = fitPoissonRegression(matches, { halfLifeDays: 0 });
  assert.equal(fit.ok, true);
  assert.equal(fit.reliable, true);
  close(fit.homeAdvantage, homeEdge, 0.12, 'home advantage');

  // Ratings are only identifiable up to a shift, so compare the ordering and
  // the spread between the strongest and weakest attack.
  const ranked = [...fit.ratings.entries()].sort((a, b) => b[1].attack - a[1].attack);
  assert.equal(ranked[0][0], 'A');
  assert.equal(ranked[ranked.length - 1][0], 'F');
  close(ranked[0][1].attack - ranked[ranked.length - 1][1].attack, 0.8, 0.25, 'attack spread');
});

test('poisson regression handles unusable input without throwing', () => {
  assert.equal(fitPoissonRegression([]).ok, false);
  assert.equal(fitPoissonRegression([{ home: 'A', away: 'A', homeScore: 1, awayScore: 1 }]).ok, false);
  assert.equal(
    fitPoissonRegression([{ home: 'A', away: 'B', homeScore: null, awayScore: 2 }]).ok,
    false,
  );
});

test('a fitted model prices an unseen pairing but refuses an unseen team', () => {
  const sample = makeSampler(999);
  const matches = [];
  for (let i = 0; i < 200; i += 1) {
    matches.push({ home: 'A', away: 'B', homeScore: sample(1.8), awayScore: sample(1.0) });
    matches.push({ home: 'B', away: 'C', homeScore: sample(1.3), awayScore: sample(1.3) });
    matches.push({ home: 'C', away: 'A', homeScore: sample(1.0), awayScore: sample(1.7) });
  }

  const fit = fitPoissonRegression(matches, { halfLifeDays: 0 });
  assert.ok(fit.expectedGoals('A', 'C'), 'a pairing never played should still price');
  assert.equal(fit.expectedGoals('A', 'Nobody'), null);
});

test('rho estimation is unbiased on independent data', () => {
  const sample = makeSampler(2024);
  const matches = [];
  for (let i = 0; i < 900; i += 1) {
    matches.push({ home: 'A', away: 'B', homeScore: sample(1.5), awayScore: sample(1.2) });
  }
  const fit = fitPoissonRegression(matches, { halfLifeDays: 0 });
  const rho = fitDixonColesRho(matches, fit);
  assert.ok(Math.abs(rho) <= 0.08, `expected rho near zero, got ${rho}`);
});

test('recency weighting favours recent form', () => {
  const old = Array.from({ length: 60 }, () => ({
    home: 'A',
    away: 'B',
    homeScore: 0,
    awayScore: 3,
    date: '2025-01-01T00:00:00Z',
  }));
  const recent = Array.from({ length: 60 }, () => ({
    home: 'A',
    away: 'B',
    homeScore: 3,
    awayScore: 0,
    date: '2026-08-01T00:00:00Z',
  }));

  const fit = fitPoissonRegression([...old, ...recent], { halfLifeDays: 60 });
  const rates = fit.expectedGoals('A', 'B');
  assert.ok(rates.lambdaHome > rates.lambdaAway, 'recent form should dominate');
});

test('normalCdf matches known quantiles', () => {
  close(normalCdf(0), 0.5, 1e-9, 'Phi(0)');
  close(normalCdf(1.96), 0.975, 1e-5, 'Phi(1.96)');
  close(normalCdf(-1.96), 0.025, 1e-5, 'Phi(-1.96)');
  close(normalCdf(110, 100, 10), normalCdf(1), 1e-9, 'scaling');
});

test('basketball markets are two-way and consistent', () => {
  const markets = buildBasketballMarkets(114, 108, { marginSd: 12, totalSd: 17 });
  close(markets.outcome.home + markets.outcome.away, 1, 1e-9, 'moneyline sum');
  assert.equal(markets.outcome.draw, 0, 'basketball has no draw market');
  assert.ok(markets.outcome.home > 0.5, 'the favourite should be favoured');
  for (const total of markets.totals) close(total.over + total.under, 1, 1e-9, 'totals sum');
  for (const spread of markets.handicaps) close(spread.home + spread.away, 1, 1e-9, 'spread sum');
});

test('a level basketball matchup is a coin flip', () => {
  const markets = buildBasketballMarkets(110, 110, { marginSd: 12, totalSd: 17 });
  close(markets.outcome.home, 0.5, 1e-9, 'even moneyline');
});

test('linear ratings recover a scoring gap', () => {
  const matches = [];
  for (let i = 0; i < 120; i += 1) {
    matches.push({ home: 'Strong', away: 'Weak', homeScore: 118 + (i % 5), awayScore: 100 + (i % 4) });
    matches.push({ home: 'Weak', away: 'Strong', homeScore: 102 + (i % 3), awayScore: 115 + (i % 6) });
  }

  const fit = fitLinearRatings(matches);
  assert.equal(fit.ok, true);
  const points = fit.expectedPoints('Strong', 'Weak');
  assert.ok(points.home > points.away + 8, 'the stronger team should project ahead');
  assert.ok(fit.marginSd > 0 && fit.totalSd > 0);
});

test('binomial coefficients are correct', () => {
  assert.equal(binomial(3, 1), 3);
  assert.equal(binomial(4, 2), 6);
  assert.equal(binomial(5, 0), 1);
  assert.equal(binomial(3, 5), 0);
});

test('the set distribution sums to one and matches the closed form', () => {
  for (const p of [0.4, 0.5, 0.6, 0.75]) {
    const distribution = setScoreDistribution(p, 3);
    const total = distribution.reduce((sum, o) => sum + o.probability, 0);
    close(total, 1, 1e-12, `distribution sums at p=${p}`);

    const q = 1 - p;
    const closedForm = p ** 3 * (1 + 3 * q + 6 * q * q);
    const modelled = distribution
      .filter((o) => o.home > o.away)
      .reduce((sum, o) => sum + o.probability, 0);
    close(modelled, closedForm, 1e-12, `match win at p=${p}`);
  }
});

test('volleyball markets are two-way and monotone in set strength', () => {
  const even = buildVolleyballMarkets(0.5);
  close(even.outcome.home, 0.5, 1e-12, 'even match');
  assert.equal(even.outcome.draw, 0, 'volleyball has no draw');

  const strong = buildVolleyballMarkets(0.7);
  assert.ok(strong.outcome.home > even.outcome.home);
  assert.ok(strong.handicaps[0].home > even.handicaps[0].home, '-1.5 sets should get easier');

  for (const total of strong.totals) close(total.over + total.under, 1, 1e-12, 'totals sum');
});

test('a dominant side is more likely to finish in three sets', () => {
  const even = buildVolleyballMarkets(0.5).totals.find((t) => t.line === 3.5);
  const strong = buildVolleyballMarkets(0.8).totals.find((t) => t.line === 3.5);
  assert.ok(strong.over < even.over, 'dominance should shorten matches');
});

test('set ratings recover a dominant team', () => {
  const matches = [];
  for (let i = 0; i < 60; i += 1) {
    matches.push({ home: 'Italy', away: 'Brazil', homeScore: 3, awayScore: 1 });
    matches.push({ home: 'Brazil', away: 'Italy', homeScore: 1, awayScore: 3 });
  }

  const fit = fitSetRatings(matches);
  assert.equal(fit.ok, true);
  const p = fit.setProbability('Italy', 'Brazil');
  assert.ok(p > 0.6, `Italy should be favoured per set, got ${p}`);
  assert.equal(fit.setProbability('Italy', 'Nobody'), null);
});

test('fitModel dispatches per sport and refuses unsupported ones', () => {
  const history = Array.from({ length: 40 }, (_, i) => ({
    home: i % 2 ? 'A' : 'B',
    away: i % 2 ? 'B' : 'A',
    homeScore: 2,
    awayScore: 1,
    status: { finished: true },
    kickoff: '2026-08-01T00:00:00Z',
  }));

  assert.equal(fitModel('football', history).ok, true);
  assert.equal(fitModel('basketball', history).ok, true);
  assert.equal(fitModel('volleyball', history).ok, true);
  assert.equal(fitModel('cricket', history).ok, false);
  assert.equal(fitModel('football', []).ok, false);
});

test('unfinished fixtures are excluded from training', () => {
  const history = [
    { home: 'A', away: 'B', homeScore: 2, awayScore: 1, status: { finished: false } },
    { home: 'A', away: 'B', homeScore: null, awayScore: null, status: { finished: true } },
  ];
  assert.equal(fitModel('football', history).ok, false);
});

test('summariseMarkets emits rounded percentages the client can render', () => {
  const history = Array.from({ length: 60 }, (_, i) => ({
    home: i % 2 ? 'A' : 'B',
    away: i % 2 ? 'B' : 'A',
    homeScore: 2,
    awayScore: 1,
    status: { finished: true },
    kickoff: '2026-08-01T00:00:00Z',
  }));

  const model = fitModel('football', history);
  const summary = summariseMarkets(model.predict({ home: 'A', away: 'B' }));

  assert.equal(summary.model, 'poisson');
  assert.equal(summary.expected.unit, 'goals');
  close(
    summary.outcome.home + summary.outcome.draw + summary.outcome.away,
    100,
    0.2,
    'percentages sum to 100',
  );
  assert.equal(summariseMarkets(null), null);
});
