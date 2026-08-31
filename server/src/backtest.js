'use strict';

const { fitModel } = require('./models');

/**
 * Measures how good the model actually is.
 *
 * A strike-rate target only means something if it is measured, and measured
 * honestly: the model must never be scored on matches it was fitted on. This
 * splits a league's history chronologically, fits on the earlier part and
 * predicts the later part, so every score comes from genuinely unseen fixtures.
 *
 * The headline output is `byThreshold`: for each confidence level, how often
 * the model was right and how many picks that leaves. That answers "what
 * confidence do we need for an 80% strike rate, and is there any board left
 * at that level" — which no amount of tuning can answer from the fit alone.
 */

const DEFAULT_THRESHOLDS = [0.4, 0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9];

/** Actual outcome label for a finished fixture. */
function actualOutcome(fixture) {
  const home = fixture.homeScore;
  const away = fixture.awayScore;
  if (typeof home !== 'number' || typeof away !== 'number') return null;
  if (home > away) return 'home';
  if (away > home) return 'away';
  return 'draw';
}

/** Probability the model assigned to each outcome, as fractions summing to 1. */
function probabilitiesFrom(markets) {
  if (!markets?.outcome) return null;
  const raw = {
    home: markets.outcome.home ?? 0,
    draw: markets.outcome.draw ?? 0,
    away: markets.outcome.away ?? 0,
  };
  const total = raw.home + raw.draw + raw.away;
  if (!(total > 0)) return null;
  return { home: raw.home / total, draw: raw.draw / total, away: raw.away / total };
}

/**
 * Multiclass Brier score: mean squared error across outcomes.
 * 0 is perfect. Always guessing 1/3 scores about 0.67.
 */
function brierScore(probabilities, actual) {
  let total = 0;
  for (const key of ['home', 'draw', 'away']) {
    const observed = key === actual ? 1 : 0;
    total += (probabilities[key] - observed) ** 2;
  }
  return total;
}

/** How well-separated the predicted probabilities are, in reliability bins. */
function buildCalibration(predictions, binCount = 10) {
  const bins = Array.from({ length: binCount }, (_, i) => ({
    from: Math.round((i / binCount) * 100),
    to: Math.round(((i + 1) / binCount) * 100),
    count: 0,
    predictedSum: 0,
    correct: 0,
  }));

  for (const p of predictions) {
    const index = Math.min(Math.floor(p.confidence * binCount), binCount - 1);
    const bin = bins[index];
    bin.count += 1;
    bin.predictedSum += p.confidence;
    if (p.correct) bin.correct += 1;
  }

  return bins
    .filter((bin) => bin.count > 0)
    .map((bin) => ({
      range: `${bin.from}-${bin.to}%`,
      picks: bin.count,
      meanPredicted: Math.round((bin.predictedSum / bin.count) * 1000) / 10,
      observed: Math.round((bin.correct / bin.count) * 1000) / 10,
      // Positive means the model claimed more confidence than it earned.
      overconfidencePoints:
        Math.round(((bin.predictedSum / bin.count) - bin.correct / bin.count) * 1000) / 10,
    }));
}

/** Strike rate and volume at each confidence cut-off. */
function buildThresholdTable(predictions, thresholds = DEFAULT_THRESHOLDS) {
  return thresholds.map((threshold) => {
    const selected = predictions.filter((p) => p.confidence >= threshold);
    const correct = selected.filter((p) => p.correct).length;

    return {
      minConfidence: Math.round(threshold * 100),
      picks: selected.length,
      // Share of the whole test set that survives this filter.
      coverage: predictions.length
        ? Math.round((selected.length / predictions.length) * 1000) / 10
        : 0,
      strikeRate: selected.length ? Math.round((correct / selected.length) * 1000) / 10 : null,
    };
  });
}

/**
 * Runs time-series cross-validation over one league's history.
 *
 * @param {string} sport
 * @param {object[]} history  finished fixtures, any order
 * @param {object} options
 * @param {number} options.folds  sequential test blocks; each is predicted using
 *   only the fixtures that preceded it.
 * @param {number} options.minTrain  fixtures required before scoring begins
 */
function runBacktest(sport, history, { folds = 4, minTrain = 60, thresholds } = {}) {
  const finished = history
    .filter((f) => f?.status?.finished && actualOutcome(f) !== null && f.home && f.away)
    .sort((a, b) => new Date(a.kickoff ?? 0) - new Date(b.kickoff ?? 0));

  if (finished.length < minTrain + 10) {
    return {
      ok: false,
      reason: `need at least ${minTrain + 10} finished fixtures, have ${finished.length}`,
      available: finished.length,
    };
  }

  const predictions = [];
  const testable = finished.length - minTrain;
  const foldSize = Math.max(Math.floor(testable / folds), 1);

  for (let fold = 0; fold < folds; fold += 1) {
    const trainEnd = minTrain + fold * foldSize;
    const testEnd = fold === folds - 1 ? finished.length : trainEnd + foldSize;
    if (trainEnd >= finished.length) break;

    const train = finished.slice(0, trainEnd);
    const test = finished.slice(trainEnd, testEnd);
    if (test.length === 0) continue;

    const model = fitModel(sport, train);
    if (!model.ok) continue;

    for (const fixture of test) {
      const markets = model.predict(fixture);
      const probabilities = probabilitiesFrom(markets);
      if (!probabilities) continue;

      const actual = actualOutcome(fixture);
      const pick = ['home', 'draw', 'away'].reduce((best, key) =>
        probabilities[key] > probabilities[best] ? key : best,
      );

      predictions.push({
        fold,
        match: `${fixture.home} vs ${fixture.away}`,
        pick,
        actual,
        correct: pick === actual,
        confidence: probabilities[pick],
        brier: brierScore(probabilities, actual),
        // Clamped so a zero-probability outcome cannot produce -Infinity.
        logLoss: -Math.log(Math.max(probabilities[actual], 1e-9)),
      });
    }
  }

  if (predictions.length === 0) {
    return { ok: false, reason: 'no fold produced a usable fit', available: finished.length };
  }

  const correct = predictions.filter((p) => p.correct).length;
  const mean = (key) => predictions.reduce((sum, p) => sum + p[key], 0) / predictions.length;

  // What always backing the home team would have scored, as a floor to beat.
  const homeBaseline = predictions.filter((p) => p.actual === 'home').length / predictions.length;

  return {
    ok: true,
    sport,
    trainedFrom: finished[0].kickoff,
    testedTo: finished[finished.length - 1].kickoff,
    fixturesAvailable: finished.length,
    predictionsScored: predictions.length,
    accuracy: Math.round((correct / predictions.length) * 1000) / 10,
    homeBaseline: Math.round(homeBaseline * 1000) / 10,
    brier: Math.round(mean('brier') * 1000) / 1000,
    logLoss: Math.round(mean('logLoss') * 1000) / 1000,
    calibration: buildCalibration(predictions),
    byThreshold: buildThresholdTable(predictions, thresholds),
  };
}

module.exports = {
  runBacktest,
  actualOutcome,
  probabilitiesFrom,
  brierScore,
  buildCalibration,
  buildThresholdTable,
  DEFAULT_THRESHOLDS,
};
