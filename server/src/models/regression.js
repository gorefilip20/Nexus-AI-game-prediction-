'use strict';

const { scoreMatrix, poissonPmf, dixonColesFactor } = require('./poisson');

/**
 * Poisson regression for team strength.
 *
 * Fits, by penalised maximum likelihood over historical results:
 *
 *   log lambdaHome = mu + attack[home] - defence[away] + homeAdvantage
 *   log lambdaAway = mu + attack[away] - defence[home]
 *
 * Attack and defence are centred each step so the parameters are identifiable,
 * and an L2 penalty shrinks teams with few matches toward league average
 * instead of letting a 5-0 in one game dominate their rating.
 */

const DEFAULT_OPTIONS = {
  iterations: 600,
  learningRate: 0.05,
  ridge: 0.35,
  halfLifeDays: 240,
  minMatches: 20,
};

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * Exponential recency weight. Football form drifts, so a match a season ago
 * should not count as much as one from last week.
 */
function recencyWeight(matchDate, referenceDate, halfLifeDays) {
  if (!halfLifeDays || !matchDate) return 1;
  const ageMs = referenceDate.getTime() - new Date(matchDate).getTime();
  if (!Number.isFinite(ageMs) || ageMs <= 0) return 1;
  const ageDays = ageMs / 86_400_000;
  return Math.pow(0.5, ageDays / halfLifeDays);
}

/**
 * @param {Array<{home:string,away:string,homeScore:number,awayScore:number,date?:string}>} matches
 */
function fitPoissonRegression(matches, options = {}) {
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

  if (usable.length === 0) {
    return { ok: false, reason: 'no usable matches', matchCount: 0 };
  }

  const teams = [...new Set(usable.flatMap((m) => [m.home, m.away]))];
  const index = new Map(teams.map((team, i) => [team, i]));

  const attack = new Array(teams.length).fill(0);
  const defence = new Array(teams.length).fill(0);

  const referenceDate = new Date(
    Math.max(...usable.map((m) => new Date(m.date ?? Date.now()).getTime() || Date.now())),
  );
  const weights = usable.map((m) => recencyWeight(m.date, referenceDate, opts.halfLifeDays));
  const weightTotal = weights.reduce((a, b) => a + b, 0) || 1;

  // Sensible starting point: overall scoring rate and observed home edge.
  const weightedGoals = usable.reduce(
    (acc, m, i) => acc + weights[i] * (m.homeScore + m.awayScore),
    0,
  );
  let mu = Math.log(Math.max(weightedGoals / (2 * weightTotal), 0.05));
  const homeGoals = usable.reduce((acc, m, i) => acc + weights[i] * m.homeScore, 0);
  const awayGoals = usable.reduce((acc, m, i) => acc + weights[i] * m.awayScore, 0);
  let homeAdvantage = Math.log(Math.max(homeGoals, 0.5) / Math.max(awayGoals, 0.5));

  const lr = opts.learningRate;

  for (let step = 0; step < opts.iterations; step += 1) {
    let gradMu = 0;
    let gradHome = 0;
    const gradAttack = new Array(teams.length).fill(0);
    const gradDefence = new Array(teams.length).fill(0);

    for (let i = 0; i < usable.length; i += 1) {
      const match = usable[i];
      const w = weights[i];
      const h = index.get(match.home);
      const a = index.get(match.away);

      const lambdaHome = Math.exp(mu + attack[h] - defence[a] + homeAdvantage);
      const lambdaAway = Math.exp(mu + attack[a] - defence[h]);

      const residualHome = w * (match.homeScore - lambdaHome);
      const residualAway = w * (match.awayScore - lambdaAway);

      gradMu += residualHome + residualAway;
      gradHome += residualHome;

      gradAttack[h] += residualHome;
      gradAttack[a] += residualAway;
      gradDefence[a] -= residualHome;
      gradDefence[h] -= residualAway;
    }

    for (let t = 0; t < teams.length; t += 1) {
      gradAttack[t] -= opts.ridge * attack[t];
      gradDefence[t] -= opts.ridge * defence[t];
    }

    const scale = lr / weightTotal;
    mu += scale * gradMu;
    homeAdvantage += scale * gradHome;
    for (let t = 0; t < teams.length; t += 1) {
      attack[t] += scale * gradAttack[t];
      defence[t] += scale * gradDefence[t];
    }

    // Re-centre: only differences between teams are identifiable.
    const attackMean = mean(attack);
    const defenceMean = mean(defence);
    for (let t = 0; t < teams.length; t += 1) {
      attack[t] -= attackMean;
      defence[t] -= defenceMean;
    }
    mu += attackMean - defenceMean;
  }

  const ratings = new Map(
    teams.map((team, i) => [team, { attack: attack[i], defence: defence[i] }]),
  );

  return {
    ok: true,
    matchCount: usable.length,
    teamCount: teams.length,
    mu,
    homeAdvantage,
    ratings,
    // Below this the fit is too thin to publish as a probability.
    reliable: usable.length >= opts.minMatches,

    /** Expected goals for a fixture, or null when either team is unseen. */
    expectedGoals(home, away) {
      const h = ratings.get(home);
      const a = ratings.get(away);
      if (!h || !a) return null;
      return {
        lambdaHome: Math.exp(mu + h.attack - a.defence + homeAdvantage),
        lambdaAway: Math.exp(mu + a.attack - h.defence),
      };
    },
  };
}

/**
 * Grid-searches the Dixon-Coles low-score parameter on the fitted rates.
 * Returns 0 when the correction does not improve the likelihood.
 */
function fitDixonColesRho(matches, fit, { candidates } = {}) {
  if (!fit?.ok) return 0;

  const grid =
    candidates ?? Array.from({ length: 21 }, (_, i) => -0.2 + i * 0.02);

  let best = 0;
  let bestLogLik = -Infinity;

  for (const rho of grid) {
    let logLik = 0;

    for (const match of matches) {
      const rates = fit.expectedGoals(match.home, match.away);
      if (!rates) continue;
      if (!Number.isFinite(match.homeScore) || !Number.isFinite(match.awayScore)) continue;

      const base =
        poissonPmf(match.homeScore, rates.lambdaHome) *
        poissonPmf(match.awayScore, rates.lambdaAway);
      const factor = dixonColesFactor(
        match.homeScore,
        match.awayScore,
        rates.lambdaHome,
        rates.lambdaAway,
        rho,
      );
      const density = base * factor;
      if (density <= 0) {
        logLik = -Infinity;
        break;
      }
      logLik += Math.log(density);
    }

    if (logLik > bestLogLik) {
      bestLogLik = logLik;
      best = rho;
    }
  }

  return Math.round(best * 1000) / 1000;
}

module.exports = { fitPoissonRegression, fitDixonColesRho, recencyWeight, scoreMatrix };
