'use strict';

const { fitModel, summariseMarkets } = require('./models');
const { encodeSlip } = require('./slip');
const { SPORT_NAMES } = require('./providers/apiSports');

/** Normalises a team name for loose comparison. */
const normalise = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Loose match so "Brighton" finds "Brighton & Hove Albion". */
function teamMatches(candidate, query) {
  const a = normalise(candidate);
  const b = normalise(query);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * Runs the probability engine against one named fixture.
 *
 * Returns a discriminated result rather than throwing, so the caller can
 * distinguish "not scheduled" from "scheduled but unmodellable" — a distinction
 * that matters, because neither may be answered with an invented number.
 */
async function runScenario({ provider, home, away, sport = null, date, logger = console } = {}) {
  const sports = sport && SPORT_NAMES.includes(sport) ? [sport] : SPORT_NAMES;
  const scanned = [];

  let fixture = null;
  const scheduleErrors = [];

  for (const candidateSport of sports) {
    let fixtures = [];
    try {
      fixtures = await provider.listFixturesByDate(candidateSport, date);
    } catch (err) {
      scheduleErrors.push({ sport: candidateSport, error: err.message });
      logger?.warn?.(`${candidateSport} schedule unavailable: ${err.message}`);
      continue;
    }

    scanned.push(...fixtures);

    const match = fixtures.find(
      (f) =>
        (teamMatches(f.home, home) && teamMatches(f.away, away)) ||
        (teamMatches(f.home, away) && teamMatches(f.away, home)),
    );

    if (match) {
      fixture = match;
      break;
    }
  }

  if (!fixture) {
    return { status: 'not_scheduled', date, query: { home, away }, scanned, scheduleErrors };
  }

  const history = await provider.getHistory(fixture.sport, fixture.leagueId, fixture.season);
  if (history.length === 0) {
    return { status: 'no_history', fixture, date, scanned: scanned.length };
  }

  const model = fitModel(fixture.sport, history);
  if (!model.ok) {
    return { status: 'fit_failed', fixture, reason: model.reason, historyCount: history.length };
  }

  const markets = summariseMarkets(model.predict(fixture));
  if (!markets) {
    return { status: 'unrated_team', fixture, historyCount: history.length };
  }

  return {
    status: 'ok',
    fixture,
    markets,
    historyCount: history.length,
    slipCode: encodeSlip(fixture, markets),
  };
}

/** Adds the market comparison, when odds exist for the fixture. */
async function withMarketComparison(result, provider) {
  if (result.status !== 'ok') return result;

  try {
    const board = await provider.getSlips();
    const priced = board.slips.find((s) => s.id === result.fixture.id);
    if (!priced?.oddsAvailable) return result;

    const modelSide =
      priced.pickLabel === 'Home'
        ? result.markets.outcome.home
        : priced.pickLabel === 'Away'
          ? result.markets.outcome.away
          : result.markets.outcome.draw;

    return {
      ...result,
      comparison: {
        favourite: priced.prediction,
        odd: priced.odd,
        bookmaker: priced.bookmaker,
        marketImplied: priced.probability,
        modelOnSide: modelSide,
        edge:
          modelSide !== null && priced.probability !== null
            ? Math.round((modelSide - priced.probability) * 10) / 10
            : null,
      },
    };
  } catch {
    // The model output stands on its own; odds here are a bonus.
    return result;
  }
}

module.exports = { runScenario, withMarketComparison, teamMatches };
