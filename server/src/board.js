'use strict';

const { fitModel, summariseMarkets } = require('./models');
const { encodeSlip } = require('./slip');

/**
 * Assembles the prediction board: provider fixtures and odds, plus model
 * probabilities fitted from that league's real finished matches.
 *
 * Models are fitted per league-season and reused across every fixture in it, so
 * a full board costs one history request per league rather than one per match.
 */
async function buildBoard({ provider, logger = console, modelEnabled = true } = {}) {
  const board = await provider.getSlips();

  if (!modelEnabled || !provider.live || typeof provider.getHistory !== 'function') {
    return {
      ...board,
      modelEnabled: false,
      slips: board.slips.map((slip) => ({ ...slip, model: null, slipCode: encodeSlip(slip) })),
    };
  }

  // One fit per league-season, shared by all that league's fixtures.
  const groups = new Map();
  for (const slip of board.slips) {
    if (!slip.leagueId || !slip.season) continue;
    const key = `${slip.sport}:${slip.leagueId}:${slip.season}`;
    if (!groups.has(key)) {
      groups.set(key, { sport: slip.sport, leagueId: slip.leagueId, season: slip.season, slips: [] });
    }
    groups.get(key).slips.push(slip);
  }

  const models = new Map();
  const modelNotes = [];

  await Promise.all(
    [...groups.entries()].map(async ([key, group]) => {
      try {
        const history = await provider.getHistory(group.sport, group.leagueId, group.season);
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

  const slips = board.slips.map((slip) => {
    const key = `${slip.sport}:${slip.leagueId}:${slip.season}`;
    const model = models.get(key);
    const markets = model ? summariseMarkets(model.predict(slip)) : null;

    return { ...slip, model: markets, slipCode: encodeSlip(slip, markets) };
  });

  return { ...board, modelEnabled: true, modelNotes, slips };
}

module.exports = { buildBoard };
