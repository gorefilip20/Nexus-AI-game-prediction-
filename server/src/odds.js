'use strict';

/**
 * Decimal odds carry the bookmaker's margin ("overround"): the raw implied
 * probabilities of a market sum to more than 1. These helpers convert odds to
 * probabilities and strip that margin, so a displayed percentage means "the
 * market's view", not "the bookmaker's padded number".
 */

/** Decimal odds -> raw implied probability. Returns null for unusable odds. */
function impliedProbability(decimalOdds) {
  const odds = typeof decimalOdds === 'string' ? Number.parseFloat(decimalOdds) : decimalOdds;
  if (!Number.isFinite(odds) || odds <= 1) return null;
  return 1 / odds;
}

/** Sum of raw implied probabilities; 1.05 means a 5% margin. */
function overround(decimalOddsList) {
  const probabilities = decimalOddsList.map(impliedProbability);
  if (probabilities.some((p) => p === null)) return null;
  return probabilities.reduce((total, p) => total + p, 0);
}

/**
 * Normalises a market's odds into probabilities summing to 1.
 * Returns null when any leg is unusable, since a partial market cannot be devigged.
 */
function devig(decimalOddsList) {
  const probabilities = decimalOddsList.map(impliedProbability);
  if (!probabilities.length || probabilities.some((p) => p === null)) return null;
  const total = probabilities.reduce((sum, p) => sum + p, 0);
  if (total <= 0) return null;
  return probabilities.map((p) => p / total);
}

/**
 * Picks the market favourite from labelled decimal odds.
 * @param {Array<{label: string, odd: string|number}>} outcomes
 * @returns {{label: string, odd: number, probability: number, overround: number}|null}
 */
function favourite(outcomes) {
  if (!Array.isArray(outcomes) || outcomes.length < 2) return null;

  const odds = outcomes.map((o) => o.odd);
  const fair = devig(odds);
  if (!fair) return null;

  let bestIndex = 0;
  for (let i = 1; i < fair.length; i += 1) {
    if (fair[i] > fair[bestIndex]) bestIndex = i;
  }

  return {
    label: outcomes[bestIndex].label,
    odd: Number.parseFloat(outcomes[bestIndex].odd),
    probability: fair[bestIndex],
    overround: overround(odds),
  };
}

module.exports = { impliedProbability, overround, devig, favourite };
