'use strict';

/**
 * Set-based model for volleyball.
 *
 * A volleyball match is a race to a fixed number of sets, so the natural unit is
 * the set, not the point. Team ratings are fitted by logistic regression on
 * historical set outcomes, then the match markets follow in closed form from the
 * per-set win probability.
 */

const DEFAULT_OPTIONS = {
  iterations: 900,
  learningRate: 0.12,
  ridge: 0.6,
  minMatches: 15,
};

function sigmoid(x) {
  if (x >= 0) return 1 / (1 + Math.exp(-x));
  const z = Math.exp(x);
  return z / (1 + z);
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

function binomial(n, k) {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i += 1) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

/**
 * Logistic regression over set outcomes:
 *   P(home wins a set) = sigmoid(rating[home] - rating[away] + homeAdvantage)
 *
 * Each match contributes its sets as weighted Bernoulli trials, so a 3-2 is
 * correctly treated as much weaker evidence than a 3-0.
 */
function fitSetRatings(matches, options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const usable = matches.filter(
    (m) =>
      m &&
      m.home &&
      m.away &&
      Number.isFinite(m.homeScore) &&
      Number.isFinite(m.awayScore) &&
      m.homeScore + m.awayScore > 0 &&
      m.home !== m.away,
  );

  if (usable.length === 0) return { ok: false, reason: 'no usable matches', matchCount: 0 };

  const teams = [...new Set(usable.flatMap((m) => [m.home, m.away]))];
  const index = new Map(teams.map((t, i) => [t, i]));
  const rating = new Array(teams.length).fill(0);

  const homeSets = usable.reduce((acc, m) => acc + m.homeScore, 0);
  const totalSets = usable.reduce((acc, m) => acc + m.homeScore + m.awayScore, 0);
  const homeShare = Math.min(Math.max(homeSets / totalSets, 0.05), 0.95);
  let homeAdvantage = Math.log(homeShare / (1 - homeShare));

  for (let step = 0; step < opts.iterations; step += 1) {
    const grad = new Array(teams.length).fill(0);
    let gradHome = 0;

    for (const match of usable) {
      const h = index.get(match.home);
      const a = index.get(match.away);
      const p = sigmoid(rating[h] - rating[a] + homeAdvantage);
      const sets = match.homeScore + match.awayScore;

      // d/dtheta of the Bernoulli log-likelihood over this match's sets.
      const residual = match.homeScore - sets * p;
      grad[h] += residual;
      grad[a] -= residual;
      gradHome += residual;
    }

    for (let t = 0; t < teams.length; t += 1) grad[t] -= opts.ridge * rating[t];

    const scale = opts.learningRate / usable.length;
    for (let t = 0; t < teams.length; t += 1) rating[t] += scale * grad[t];
    homeAdvantage += scale * gradHome;

    const ratingMean = mean(rating);
    for (let t = 0; t < teams.length; t += 1) rating[t] -= ratingMean;
  }

  const ratings = new Map(teams.map((t, i) => [t, rating[i]]));

  return {
    ok: true,
    matchCount: usable.length,
    teamCount: teams.length,
    homeAdvantage,
    ratings,
    reliable: usable.length >= opts.minMatches,

    /** Probability the home team takes any given set. */
    setProbability(home, away) {
      const h = ratings.get(home);
      const a = ratings.get(away);
      if (h === undefined || a === undefined) return null;
      return sigmoid(h - a + homeAdvantage);
    },
  };
}

/**
 * Distribution over final set scores for a race to `setsToWin`.
 * Returns entries like { home: 3, away: 1, probability }.
 */
function setScoreDistribution(p, setsToWin = 3) {
  const q = 1 - p;
  const outcomes = [];

  for (let lost = 0; lost < setsToWin; lost += 1) {
    // The decisive set must be the last one, so arrange the other losses freely.
    const ways = binomial(setsToWin - 1 + lost, lost);
    outcomes.push({
      home: setsToWin,
      away: lost,
      probability: ways * p ** setsToWin * q ** lost,
    });
    outcomes.push({
      home: lost,
      away: setsToWin,
      probability: ways * q ** setsToWin * p ** lost,
    });
  }

  return outcomes;
}

/** Markets for a volleyball fixture, all derived from the set distribution. */
function buildVolleyballMarkets(setProbability, { setsToWin = 3, handicaps = [-1.5, 1.5] } = {}) {
  const outcomes = setScoreDistribution(setProbability, setsToWin);

  const homeWin = outcomes
    .filter((o) => o.home > o.away)
    .reduce((acc, o) => acc + o.probability, 0);

  const totalLines = [];
  const maxSets = setsToWin * 2 - 1;
  for (let line = setsToWin + 0.5; line < maxSets; line += 1) {
    const over = outcomes
      .filter((o) => o.home + o.away > line)
      .reduce((acc, o) => acc + o.probability, 0);
    totalLines.push({ line, over, under: 1 - over, push: 0 });
  }

  return {
    model: 'logistic-sets',
    setProbability,
    setsToWin,
    // No draw is possible: a volleyball match always produces a winner.
    outcome: { home: homeWin, draw: 0, away: 1 - homeWin },
    handicaps: handicaps.map((handicap) => {
      const home = outcomes
        .filter((o) => o.home - o.away + handicap > 0)
        .reduce((acc, o) => acc + o.probability, 0);
      return { handicap, home, away: 1 - home, push: 0 };
    }),
    totals: totalLines,
    scorelines: outcomes
      .sort((a, b) => b.probability - a.probability)
      .slice(0, 5)
      .map((o) => ({ home: o.home, away: o.away, probability: o.probability })),
  };
}

module.exports = { sigmoid, binomial, fitSetRatings, setScoreDistribution, buildVolleyballMarkets };
