'use strict';

const { enrichSlips } = require('./board');
const { SPORT_NAMES } = require('./providers/apiSports');

const MAX_DAYS = 7;
const MAX_RESULTS = 30;

/** Normalises a name for loose comparison: "Brighton & Hove" -> "brightonhove". */
const normalise = (value) => String(value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Matches a query against a team or league name.
 *
 * Substring in either direction, so "Brighton" finds "Brighton & Hove Albion"
 * and a full name pasted in still finds the fixture.
 */
function matchesQuery(candidate, query) {
  const a = normalise(candidate);
  const b = normalise(query);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/** True when the query hits either team or the competition. */
function fixtureMatches(fixture, query) {
  return (
    matchesQuery(fixture.home, query) ||
    matchesQuery(fixture.away, query) ||
    matchesQuery(fixture.league, query)
  );
}

function dateStrings(days, from = new Date()) {
  const out = [];
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(from.getTime() + offset * 86_400_000);
    out.push(date.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Searches scheduled fixtures across sports and dates, then prices and analyses
 * the matches it finds.
 *
 * Quota note: this costs one schedule request per sport per day scanned (all
 * cached), plus odds and league history for the fixtures that actually match.
 * `days` is capped so a wide query cannot burn the daily allowance.
 */
async function searchFixtures({
  provider,
  query,
  sport = null,
  days = 2,
  limit = 12,
  includeFinished = false,
  logger = console,
  modelEnabled = true,
  now = () => new Date(),
} = {}) {
  const trimmed = String(query ?? '').trim();
  const scanDays = Math.min(Math.max(Number(days) || 1, 1), MAX_DAYS);

  // One shape for every exit path, so a caller never has to branch on
  // "did anything match" to know which fields exist.
  const base = {
    query: trimmed,
    sport: sport ?? null,
    daysScanned: scanDays,
    scanned: 0,
    matched: 0,
    truncated: false,
    modelEnabled: false,
    modelNotes: [],
    errors: [],
    results: [],
  };

  if (trimmed.length < 2) {
    return { ...base, daysScanned: 0, reason: 'query too short' };
  }

  const sports = sport && SPORT_NAMES.includes(sport) ? [sport] : SPORT_NAMES;
  const cappedLimit = Math.min(Math.max(Number(limit) || 1, 1), MAX_RESULTS);
  const dates = dateStrings(scanDays, now());

  const errors = [];
  const seen = new Set();
  const matches = [];
  let scanned = 0;

  const lookups = sports.flatMap((candidateSport) =>
    dates.map(async (date) => {
      try {
        const fixtures = await provider.listFixturesByDate(candidateSport, date);
        return { sport: candidateSport, date, fixtures };
      } catch (err) {
        errors.push({ sport: candidateSport, date, error: err.message });
        logger?.warn?.(`Search: ${candidateSport} ${date} unavailable (${err.message})`);
        return { sport: candidateSport, date, fixtures: [] };
      }
    }),
  );

  for (const { fixtures } of await Promise.all(lookups)) {
    scanned += fixtures.length;

    for (const fixture of fixtures) {
      if (!fixtureMatches(fixture, trimmed)) continue;
      if (!includeFinished && fixture.status?.finished) continue;

      // The same fixture appears on both its own date and any adjacent scan.
      const key = `${fixture.sport}:${fixture.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      matches.push(fixture);
    }
  }

  matches.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
  const selected = matches.slice(0, cappedLimit);

  if (selected.length === 0) {
    return { ...base, scanned, errors, modelEnabled };
  }

  const priced =
    typeof provider.priceFixtures === 'function'
      ? await provider.priceFixtures(selected)
      : selected;

  const { slips, modelNotes, modelEnabled: enabled } = await enrichSlips({
    provider,
    slips: priced,
    logger,
    modelEnabled,
  });

  return {
    ...base,
    scanned,
    matched: matches.length,
    truncated: matches.length > selected.length,
    modelEnabled: enabled,
    modelNotes,
    errors,
    results: slips,
  };
}

module.exports = { searchFixtures, fixtureMatches, matchesQuery, dateStrings, MAX_DAYS };
