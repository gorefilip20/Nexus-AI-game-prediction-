'use strict';

const { fitModel, summariseMarkets } = require('./models');
const { encodeSlip } = require('./slip');
const { buildInsight } = require('./insight');

/**
 * Enriches priced slips with model probabilities and a generated analysis.
 *
 * Models are fitted per league-season and reused across every fixture in that
 * league, so a board costs one history request per league rather than one per
 * match. The same history is then reused for form and head-to-head, which are
 * read from the rows the fit already paid for.
 *
 * Shared by the main board and the search endpoint so both return identical
 * slip shapes.
 */
/**
 * Top model probability for a slip, as a percentage, or null.
 * This is the number the confidence filter acts on.
 */
function modelConfidence(markets) {
  if (!markets?.outcome) return null;
  const { home = 0, draw = 0, away = 0 } = markets.outcome;
  return Math.max(home, draw, away);
}

async function enrichSlips({
  provider,
  slips,
  logger = console,
  modelEnabled = true,
  minConfidence = 0,
} = {}) {
  const canModel =
    modelEnabled && provider.live && typeof provider.getHistory === 'function';

  if (!canModel) {
    return {
      modelEnabled: false,
      modelNotes: [],
      slips: slips.map((slip) => {
        const insight = buildInsight({ fixture: slip, model: null, slip, history: [] });
        return {
          ...slip,
          model: null,
          insight,
          matchJustification: insight.matchJustification,
          slipCode: encodeSlip(slip),
          confidence: null,
          highConfidence: false,
        };
      }),
      minConfidence,
      highConfidenceCount: 0,
    };
  }

  const groups = new Map();
  for (const slip of slips) {
    if (!slip.leagueId || !slip.season) continue;
    const key = `${slip.sport}:${slip.leagueId}:${slip.season}`;
    if (!groups.has(key)) {
      groups.set(key, { sport: slip.sport, leagueId: slip.leagueId, season: slip.season });
    }
  }

  const models = new Map();
  const histories = new Map();
  const modelNotes = [];

  await Promise.all(
    [...groups.entries()].map(async ([key, group]) => {
      try {
        const history = await provider.getHistory(group.sport, group.leagueId, group.season);
        histories.set(key, history);

        if (history.length === 0) {
          modelNotes.push({ league: key, note: 'no finished fixtures yet this season' });
          return;
        }

        const model = fitModel(group.sport, history);
        if (!model.ok) {
          modelNotes.push({ league: key, note: model.reason });
          return;
        }

        models.set(key, model);
        if (!model.reliable) {
          modelNotes.push({
            league: key,
            note: `fitted on only ${model.matchCount} matches — treat as provisional`,
          });
        }
      } catch (err) {
        logger?.warn?.(`Model fit failed for ${key}: ${err.message}`);
        modelNotes.push({ league: key, note: `fit failed: ${err.message}` });
      }
    }),
  );

  const enriched = slips.map((slip) => {
    const key = `${slip.sport}:${slip.leagueId}:${slip.season}`;
    const model = models.get(key);
    const markets = model ? summariseMarkets(model.predict(slip)) : null;

    const insight = buildInsight({
      fixture: slip,
      model: markets,
      slip,
      history: histories.get(key) ?? [],
      sport: slip.sport,
    });

    const confidence = modelConfidence(markets);

    return {
      ...slip,
      model: markets,
      insight,
      matchJustification: insight.matchJustification,
      slipCode: encodeSlip(slip, markets),
      confidence,
      // Every fixture stays on the board — full coverage is the point — but the
      // subset the model is confident about is flagged so the UI can lead with
      // it. Backtests show the strike rate rises sharply with this threshold,
      // and the number of qualifying picks falls just as sharply.
      highConfidence: confidence !== null && minConfidence > 0 && confidence >= minConfidence,
    };
  });

  const featured = enriched.filter((s) => s.highConfidence).length;

  return {
    modelEnabled: true,
    modelNotes,
    minConfidence,
    highConfidenceCount: featured,
    slips: enriched,
  };
}

/** The default board: today's fixtures for every sport, priced and analysed. */
async function buildBoard({ provider, logger = console, modelEnabled = true, minConfidence = 0 } = {}) {
  const board = await provider.getSlips();
  const enriched = await enrichSlips({
    provider,
    slips: board.slips,
    logger,
    modelEnabled,
    minConfidence,
  });

  return { ...board, ...enriched };
}

module.exports = { buildBoard, enrichSlips, modelConfidence };
