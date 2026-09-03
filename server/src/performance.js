'use strict';

/**
 * Profit and loss on recorded picks.
 *
 * Strike rate is not profit. Backing heavy favourites hits often and still
 * loses money, because the price is short; backing outsiders misses often and
 * can still win, because the price is long. Only staked return answers whether
 * the service is worth anything, so this measures that directly from the
 * ledger's own settled rows — real picks, at the real prices they were shown at.
 *
 * It works on the ledger rather than on a historical backtest for a reason: the
 * provider's results endpoint returns scores, not the odds that were available
 * before kick-off. Simulating profit against odds we never saw would produce a
 * number that looks authoritative and means nothing. The ledger records the
 * price at the moment the pick was surfaced, which is the only honest basis.
 */

/**
 * Profit in units from a 1-unit stake.
 *
 * Rounded to four places because binary floating point cannot hold decimal odds
 * exactly — 1.2 - 1 evaluates to 0.19999999999999996, and that error compounds
 * across a few hundred settled picks into a visibly wrong running total.
 */
function profitOf(entry) {
  if (entry.status === 'WIN') {
    const odd = Number(entry.odd);
    // A win with no recorded price cannot be valued; treat it as a push rather
    // than inventing a return.
    if (!Number.isFinite(odd) || odd <= 1) return 0;
    return Math.round((odd - 1) * 10_000) / 10_000;
  }
  if (entry.status === 'LOSS') return -1;
  return 0; // VOID and anything ungraded stake nothing.
}

/** Whether a settled entry actually put a unit at risk. */
function isStaked(entry) {
  return entry.status === 'WIN' || entry.status === 'LOSS';
}

function mean(values) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}

/**
 * Standard error of the mean return.
 *
 * Betting returns are extremely noisy: a handful of winners at long prices can
 * make a losing system look profitable. Reporting the error alongside the ROI is
 * what stops a 15-pick sample being mistaken for an edge.
 */
function standardError(returns) {
  if (returns.length < 2) return null;
  const m = mean(returns);
  const variance = returns.reduce((sum, r) => sum + (r - m) ** 2, 0) / (returns.length - 1);
  return Math.sqrt(variance / returns.length);
}

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

/** ROI within a confidence band, so an edge can be located if one exists. */
function byConfidenceBand(entries, bands = [0, 50, 60, 70, 80]) {
  return bands
    .map((floor, index) => {
      const ceiling = bands[index + 1] ?? 101;
      const inBand = entries.filter((e) => {
        const c = Number(e.probability);
        return Number.isFinite(c) && c >= floor && c < ceiling;
      });

      if (inBand.length === 0) return null;

      const returns = inBand.map(profitOf);
      const staked = inBand.length;
      const profit = returns.reduce((a, b) => a + b, 0);
      const wins = inBand.filter((e) => e.status === 'WIN').length;

      return {
        band: ceiling > 100 ? `${floor}%+` : `${floor}–${ceiling}%`,
        picks: staked,
        strikeRate: round1((wins / staked) * 100),
        profitUnits: round2(profit),
        roi: round1((profit / staked) * 100),
      };
    })
    .filter(Boolean);
}

/**
 * Full performance summary for a set of ledger entries.
 * @returns {object} `roi` is null until something has actually settled.
 */
function computePerformance(entries = []) {
  const staked = entries.filter(isStaked);

  if (staked.length === 0) {
    return {
      settled: 0,
      staked: 0,
      wins: 0,
      losses: 0,
      profitUnits: null,
      roi: null,
      roiStandardError: null,
      roiRange: null,
      averageOdds: null,
      breakEvenStrikeRate: null,
      strikeRate: null,
      verdict: 'no settled picks yet',
      significant: false,
      byConfidence: [],
    };
  }

  const returns = staked.map(profitOf);
  const profit = returns.reduce((a, b) => a + b, 0);
  const roi = (profit / staked.length) * 100;
  const wins = staked.filter((e) => e.status === 'WIN').length;

  const odds = staked.map((e) => Number(e.odd)).filter((o) => Number.isFinite(o) && o > 1);
  const averageOdds = odds.length ? mean(odds) : null;

  const error = standardError(returns);
  const errorPercent = error === null ? null : error * 100;

  // Two standard errors either side — the honest width of the estimate.
  const roiRange =
    errorPercent === null
      ? null
      : { low: round1(roi - 2 * errorPercent), high: round1(roi + 2 * errorPercent) };

  // Profitable only if the whole interval clears zero.
  const significant = roiRange !== null && (roiRange.low > 0 || roiRange.high < 0);

  let verdict;
  if (staked.length < 100) {
    verdict = `too few settled picks (${staked.length}) to judge — treat any ROI here as noise`;
  } else if (!significant) {
    verdict = 'no measurable edge either way: the result is inside the margin of error';
  } else if (roi > 0) {
    verdict = 'profitable over this sample, and outside the margin of error';
  } else {
    verdict = 'losing over this sample, and outside the margin of error';
  }

  return {
    settled: staked.length,
    staked: staked.length,
    wins,
    losses: staked.length - wins,
    profitUnits: round2(profit),
    roi: round1(roi),
    roiStandardError: errorPercent === null ? null : round1(errorPercent),
    roiRange,
    averageOdds: averageOdds === null ? null : round2(averageOdds),
    // The strike rate this book of picks needed just to break even.
    breakEvenStrikeRate: averageOdds ? round1((1 / averageOdds) * 100) : null,
    strikeRate: round1((wins / staked.length) * 100),
    verdict,
    significant,
    byConfidence: byConfidenceBand(staked),
  };
}

module.exports = { computePerformance, profitOf, isStaked, standardError, byConfidenceBand };
