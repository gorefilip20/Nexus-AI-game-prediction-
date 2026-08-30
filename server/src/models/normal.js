'use strict';

/**
 * Normal-margin model for basketball.
 *
 * Basketball scores are sums of many possessions, so the central limit theorem
 * makes a normal approximation to the margin and total far more appropriate than
 * a Poisson count model. Team ratings come from a ridge-penalised least-squares
 * regression on points for and against.
 */

/** Abramowitz & Stegun 7.1.26 error function; ~1.5e-7 absolute accuracy. */
function erf(x) {
  const sign = Math.sign(x);
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  return sign * y;
}

/** Standard normal CDF. */
function normalCdf(x, mean = 0, sd = 1) {
  if (!(sd > 0)) return x >= mean ? 1 : 0;
  return 0.5 * (1 + erf((x - mean) / (sd * Math.SQRT2)));
}

const DEFAULT_OPTIONS = {
  iterations: 800,
  learningRate: 0.03,
  ridge: 1.5,
  minMatches: 20,
  // Fallbacks roughly matching NBA dispersion, used when a fit is too thin.
  fallbackMarginSd: 12,
  fallbackTotalSd: 17,
};

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * Fits points = mu + offence[team] - defence[opponent] (+ home edge) by
 * penalised least squares.
 */
function fitLinearRatings(matches, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const usable = matches.filter(
    (m) =>
      m &&
      m.home &&
      m.away &&
      Number.isFinite(m.homeScore) &&
      Number.isFinite(m.awayScore) &&
      m.home !== m.away,
  );

  if (usable.length === 0) return { ok: false, reason: 'no usable matches', matchCount: 0 };

  const teams = [...new Set(usable.flatMap((m) => [m.home, m.away]))];
  const index = new Map(teams.map((t, i) => [t, i]));

  const offence = new Array(teams.length).fill(0);
  const defence = new Array(teams.length).fill(0);

  let mu = mean(usable.flatMap((m) => [m.homeScore, m.awayScore]));
  let homeAdvantage =
    mean(usable.map((m) => m.homeScore)) - mean(usable.map((m) => m.awayScore));

  for (let step = 0; step < opts.iterations; step += 1) {
    let gradMu = 0;
    let gradHome = 0;
    const gradOff = new Array(teams.length).fill(0);
    const gradDef = new Array(teams.length).fill(0);

    for (const match of usable) {
      const h = index.get(match.home);
      const a = index.get(match.away);

      const predHome = mu + offence[h] - defence[a] + homeAdvantage;
      const predAway = mu + offence[a] - defence[h];

      const residualHome = match.homeScore - predHome;
      const residualAway = match.awayScore - predAway;

      gradMu += residualHome + residualAway;
      gradHome += residualHome;
      gradOff[h] += residualHome;
      gradOff[a] += residualAway;
      gradDef[a] -= residualHome;
      gradDef[h] -= residualAway;
    }

    for (let t = 0; t < teams.length; t += 1) {
      gradOff[t] -= opts.ridge * offence[t];
      gradDef[t] -= opts.ridge * defence[t];
    }

    const scale = opts.learningRate / usable.length;
    mu += scale * gradMu;
    homeAdvantage += scale * gradHome;
    for (let t = 0; t < teams.length; t += 1) {
      offence[t] += scale * gradOff[t];
      defence[t] += scale * gradDef[t];
    }

    const offMean = mean(offence);
    const defMean = mean(defence);
    for (let t = 0; t < teams.length; t += 1) {
      offence[t] -= offMean;
      defence[t] -= defMean;
    }
    mu += offMean - defMean;
  }

  const ratings = new Map(
    teams.map((t, i) => [t, { offence: offence[i], defence: defence[i] }]),
  );

  const expected = (home, away) => {
    const h = ratings.get(home);
    const a = ratings.get(away);
    if (!h || !a) return null;
    return {
      home: mu + h.offence - a.defence + homeAdvantage,
      away: mu + a.offence - h.defence,
    };
  };

  // Residual dispersion drives every probability, so measure it rather than
  // assuming a league-average number.
  const marginResiduals = [];
  const totalResiduals = [];
  for (const match of usable) {
    const e = expected(match.home, match.away);
    if (!e) continue;
    marginResiduals.push(match.homeScore - match.awayScore - (e.home - e.away));
    totalResiduals.push(match.homeScore + match.awayScore - (e.home + e.away));
  }

  const sd = (values, fallback) => {
    if (values.length < 5) return fallback;
    const m = mean(values);
    const variance = mean(values.map((v) => (v - m) ** 2));
    const result = Math.sqrt(variance);
    return Number.isFinite(result) && result > 1 ? result : fallback;
  };

  return {
    ok: true,
    matchCount: usable.length,
    teamCount: teams.length,
    mu,
    homeAdvantage,
    ratings,
    marginSd: sd(marginResiduals, opts.fallbackMarginSd),
    totalSd: sd(totalResiduals, opts.fallbackTotalSd),
    reliable: usable.length >= opts.minMatches,
    expectedPoints: expected,
  };
}

/**
 * Markets for a basketball fixture. There is no draw market: ties go to
 * overtime, so the moneyline is a two-way split.
 */
function buildBasketballMarkets(
  expectedHome,
  expectedAway,
  { marginSd = 12, totalSd = 17, spreads = [-6.5, -3.5, 3.5, 6.5], totalLines = [] } = {},
) {
  const margin = expectedHome - expectedAway;
  const total = expectedHome + expectedAway;
  const lines = totalLines.length
    ? totalLines
    : [Math.round(total) - 5.5, Math.round(total) + 0.5, Math.round(total) + 5.5];

  const homeWin = 1 - normalCdf(0, margin, marginSd);

  return {
    model: 'normal-regression',
    expectedHome,
    expectedAway,
    expectedMargin: margin,
    expectedTotal: total,
    marginSd,
    totalSd,
    outcome: { home: homeWin, draw: 0, away: 1 - homeWin },
    handicaps: spreads.map((handicap) => {
      const home = 1 - normalCdf(0, margin + handicap, marginSd);
      return { handicap, home, away: 1 - home, push: 0 };
    }),
    totals: lines.map((line) => {
      const over = 1 - normalCdf(line, total, totalSd);
      return { line, over, under: 1 - over, push: 0 };
    }),
  };
}

module.exports = { erf, normalCdf, fitLinearRatings, buildBasketballMarkets };
