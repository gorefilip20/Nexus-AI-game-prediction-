'use strict';

const { fitPoissonRegression, fitDixonColesRho } = require('./regression');
const { buildFootballMarkets } = require('./poisson');
const { fitLinearRatings, buildBasketballMarkets } = require('./normal');
const { fitSetRatings, buildVolleyballMarkets } = require('./sets');

/**
 * Probability engine.
 *
 * Each sport gets the model its scoring process actually justifies:
 *
 *   football   Poisson regression on goals, with a Dixon-Coles low-score
 *              correction, read off a joint score matrix.
 *   basketball ridge least-squares on points, with a normal margin/total.
 *   volleyball logistic regression on set outcomes, with a race-to-3 expansion.
 *
 * Every model is fitted from real finished fixtures supplied by the provider. If
 * there is no history to fit, no probability is produced — the board shows the
 * fixture unpriced rather than inventing a number.
 */

const ENGINES = {
  football: {
    fit: (history, options) => {
      const fit = fitPoissonRegression(history, options);
      if (!fit.ok) return fit;
      fit.rho = fitDixonColesRho(history, fit);
      return fit;
    },
    predict: (fit, fixture, options) => {
      const rates = fit.expectedGoals(fixture.home, fixture.away);
      if (!rates) return null;
      return buildFootballMarkets(rates.lambdaHome, rates.lambdaAway, {
        rho: fit.rho ?? 0,
        ...options,
      });
    },
  },

  basketball: {
    fit: (history, options) => fitLinearRatings(history, options),
    predict: (fit, fixture, options) => {
      const points = fit.expectedPoints(fixture.home, fixture.away);
      if (!points) return null;
      return buildBasketballMarkets(points.home, points.away, {
        marginSd: fit.marginSd,
        totalSd: fit.totalSd,
        ...options,
      });
    },
  },

  volleyball: {
    fit: (history, options) => fitSetRatings(history, options),
    predict: (fit, fixture, options) => {
      const p = fit.setProbability(fixture.home, fixture.away);
      if (p === null) return null;
      return buildVolleyballMarkets(p, options);
    },
  },
};

const SUPPORTED_SPORTS = Object.keys(ENGINES);

/** Converts provider fixtures into the {home, away, homeScore, awayScore, date} rows a fit needs. */
function toTrainingRows(fixtures) {
  return fixtures
    .filter(
      (f) =>
        f?.status?.finished &&
        typeof f.homeScore === 'number' &&
        typeof f.awayScore === 'number' &&
        f.home &&
        f.away,
    )
    .map((f) => ({
      home: f.home,
      away: f.away,
      homeScore: f.homeScore,
      awayScore: f.awayScore,
      date: f.kickoff ?? null,
    }));
}

/**
 * Fits a sport's model once so it can price many fixtures.
 * @returns {{ok: boolean, sport: string, predict?: Function}}
 */
function fitModel(sport, history, options = {}) {
  const engine = ENGINES[sport];
  if (!engine) return { ok: false, sport, reason: `unsupported sport: ${sport}` };

  const rows = toTrainingRows(history);
  if (rows.length === 0) return { ok: false, sport, reason: 'no finished fixtures to learn from' };

  const fit = engine.fit(rows, options.fit);
  if (!fit.ok) return { ok: false, sport, reason: fit.reason ?? 'fit failed' };

  return {
    ok: true,
    sport,
    matchCount: fit.matchCount,
    teamCount: fit.teamCount,
    reliable: fit.reliable,
    fit,

    /** Markets for one fixture, or null when a team was never seen in training. */
    predict(fixture) {
      const markets = engine.predict(fit, fixture, options.markets);
      if (!markets) return null;
      return {
        ...markets,
        sport,
        reliable: fit.reliable,
        trainedOn: fit.matchCount,
      };
    },
  };
}

/** Rounds probabilities to one decimal percent for transport to the client. */
function toPercent(value) {
  return value === null || value === undefined ? null : Math.round(value * 1000) / 10;
}

/** Flattens a market set into the compact percentage form the API returns. */
function summariseMarkets(markets) {
  if (!markets) return null;

  return {
    model: markets.model,
    sport: markets.sport,
    reliable: markets.reliable,
    trainedOn: markets.trainedOn,
    outcome: {
      home: toPercent(markets.outcome.home),
      draw: toPercent(markets.outcome.draw),
      away: toPercent(markets.outcome.away),
    },
    totals: (markets.totals ?? []).map((t) => ({
      line: t.line,
      over: toPercent(t.over),
      under: toPercent(t.under),
      push: toPercent(t.push),
    })),
    handicaps: (markets.handicaps ?? []).map((h) => ({
      handicap: h.handicap,
      home: toPercent(h.home),
      away: toPercent(h.away),
      push: toPercent(h.push),
    })),
    btts: markets.btts
      ? { yes: toPercent(markets.btts.yes), no: toPercent(markets.btts.no) }
      : null,
    scorelines: (markets.scorelines ?? []).map((s) => ({
      home: s.home,
      away: s.away,
      probability: toPercent(s.probability),
    })),
    expected:
      markets.model === 'poisson'
        ? { home: round2(markets.lambdaHome), away: round2(markets.lambdaAway), unit: 'goals' }
        : markets.model === 'normal-regression'
          ? { home: round2(markets.expectedHome), away: round2(markets.expectedAway), unit: 'points' }
          : { home: toPercent(markets.setProbability), away: toPercent(1 - markets.setProbability), unit: 'set win %' },
  };
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

module.exports = { fitModel, summariseMarkets, toTrainingRows, SUPPORTED_SPORTS, toPercent };
