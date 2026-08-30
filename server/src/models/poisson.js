'use strict';

/**
 * Poisson goal model for football.
 *
 * Goals in a football match are well approximated by a Poisson process, so a
 * match is modelled as two independent Poisson draws with rates lambdaHome and
 * lambdaAway. Every market below is read off the resulting score matrix rather
 * than estimated separately, which guarantees the 1X2, over/under and handicap
 * numbers stay mutually consistent.
 */

const DEFAULT_MAX_GOALS = 12;

/** Poisson pmf, computed iteratively to avoid overflowing on k!. */
function poissonPmf(k, lambda) {
  if (!Number.isInteger(k) || k < 0) return 0;
  if (!Number.isFinite(lambda) || lambda < 0) return Number.NaN;
  if (lambda === 0) return k === 0 ? 1 : 0;

  let term = Math.exp(-lambda);
  for (let i = 1; i <= k; i += 1) term = (term * lambda) / i;
  return term;
}

/**
 * Dixon-Coles low-score correction.
 *
 * Independent Poisson slightly misprices 0-0, 1-0, 0-1 and 1-1, which are
 * exactly the scorelines that dominate football. rho < 0 shifts mass toward
 * draws; rho = 0 leaves the independent model untouched.
 */
function dixonColesFactor(homeGoals, awayGoals, lambdaHome, lambdaAway, rho) {
  if (rho === 0) return 1;
  if (homeGoals === 0 && awayGoals === 0) return 1 - lambdaHome * lambdaAway * rho;
  if (homeGoals === 0 && awayGoals === 1) return 1 + lambdaHome * rho;
  if (homeGoals === 1 && awayGoals === 0) return 1 + lambdaAway * rho;
  if (homeGoals === 1 && awayGoals === 1) return 1 - rho;
  return 1;
}

/**
 * Joint distribution over scorelines, renormalised so it sums to exactly 1
 * after truncation at maxGoals and any Dixon-Coles adjustment.
 */
function scoreMatrix(lambdaHome, lambdaAway, { maxGoals = DEFAULT_MAX_GOALS, rho = 0 } = {}) {
  const matrix = [];
  let total = 0;

  for (let h = 0; h <= maxGoals; h += 1) {
    matrix[h] = [];
    for (let a = 0; a <= maxGoals; a += 1) {
      const value =
        poissonPmf(h, lambdaHome) *
        poissonPmf(a, lambdaAway) *
        dixonColesFactor(h, a, lambdaHome, lambdaAway, rho);
      const clamped = Math.max(value, 0);
      matrix[h][a] = clamped;
      total += clamped;
    }
  }

  if (total > 0) {
    for (let h = 0; h <= maxGoals; h += 1) {
      for (let a = 0; a <= maxGoals; a += 1) matrix[h][a] /= total;
    }
  }

  return matrix;
}

/** Sums the matrix wherever `predicate(home, away)` holds. */
function probabilityWhere(matrix, predicate) {
  let total = 0;
  for (let h = 0; h < matrix.length; h += 1) {
    for (let a = 0; a < matrix[h].length; a += 1) {
      if (predicate(h, a)) total += matrix[h][a];
    }
  }
  return total;
}

function outcomeProbabilities(matrix) {
  return {
    home: probabilityWhere(matrix, (h, a) => h > a),
    draw: probabilityWhere(matrix, (h, a) => h === a),
    away: probabilityWhere(matrix, (h, a) => h < a),
  };
}

/**
 * Over/under for a goal line. Whole-number lines (2.0) can push, so the stake is
 * returned and the reported over/under probabilities are conditional on a
 * result — which is how such a market actually settles.
 */
function totalsProbabilities(matrix, line) {
  const push = Number.isInteger(line)
    ? probabilityWhere(matrix, (h, a) => h + a === line)
    : 0;
  const over = probabilityWhere(matrix, (h, a) => h + a > line);
  const under = probabilityWhere(matrix, (h, a) => h + a < line);
  return { line, over, under, push };
}

/**
 * Asian/European handicap applied to the home team.
 * handicap = -1.5 means home must win by two or more.
 */
function handicapProbabilities(matrix, handicap) {
  const push = Number.isInteger(handicap)
    ? probabilityWhere(matrix, (h, a) => h - a + handicap === 0)
    : 0;
  const home = probabilityWhere(matrix, (h, a) => h - a + handicap > 0);
  const away = probabilityWhere(matrix, (h, a) => h - a + handicap < 0);
  return { handicap, home, away, push };
}

function bothTeamsToScore(matrix) {
  const yes = probabilityWhere(matrix, (h, a) => h > 0 && a > 0);
  return { yes, no: 1 - yes };
}

/** The most likely exact scorelines, highest first. */
function topScorelines(matrix, limit = 5) {
  const rows = [];
  for (let h = 0; h < matrix.length; h += 1) {
    for (let a = 0; a < matrix[h].length; a += 1) {
      rows.push({ home: h, away: a, probability: matrix[h][a] });
    }
  }
  return rows.sort((x, y) => y.probability - x.probability).slice(0, limit);
}

/** Full market set for one fixture, all derived from a single score matrix. */
function buildFootballMarkets(
  lambdaHome,
  lambdaAway,
  { maxGoals = DEFAULT_MAX_GOALS, rho = 0, totalLines = [1.5, 2.5, 3.5], handicaps = [-1.5, -0.5, 0.5, 1.5] } = {},
) {
  const matrix = scoreMatrix(lambdaHome, lambdaAway, { maxGoals, rho });

  return {
    model: 'poisson',
    lambdaHome,
    lambdaAway,
    rho,
    outcome: outcomeProbabilities(matrix),
    totals: totalLines.map((line) => totalsProbabilities(matrix, line)),
    handicaps: handicaps.map((h) => handicapProbabilities(matrix, h)),
    btts: bothTeamsToScore(matrix),
    scorelines: topScorelines(matrix, 5),
  };
}

module.exports = {
  poissonPmf,
  dixonColesFactor,
  scoreMatrix,
  probabilityWhere,
  outcomeProbabilities,
  totalsProbabilities,
  handicapProbabilities,
  bothTeamsToScore,
  topScorelines,
  buildFootballMarkets,
  DEFAULT_MAX_GOALS,
};
