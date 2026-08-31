'use strict';

/**
 * Which competitions the board covers.
 *
 * The previous behaviour asked the provider for the next N fixtures worldwide,
 * which meant coverage was whatever happened to kick off soonest — in practice
 * top-tier men's football, with women's competitions appearing only by luck.
 * Coverage is now an explicit decision: a whole-day listing, filtered by rules
 * stated here.
 */

/**
 * Women's competitions across the languages API-Sports uses in league names.
 *
 * This is a name heuristic, not a provider-supplied flag — API-Sports does not
 * expose a gender field on leagues, so matching the name is the available
 * signal. It is deliberately broad: including a men's league by mistake costs a
 * few requests, while missing a women's league defeats the point.
 */
const WOMENS_PATTERNS = [
  /\bwomen'?s?\b/i,
  /\bladies\b/i,
  // Covers feminin / feminine / feminina / feminino across FR, ES and PT —
  // Portuguese uses the -o ending, which an -a-only pattern silently misses.
  /\bfeminin[aoe]?s?\b/i,
  /\bfemenin[aoe]?s?\b/i,
  /\bfemminile\b/i,             // Italian
  /\bfrauen\b/i,                // German
  /\bdames\b/i,                 // Dutch / French
  /\bkvinner\b/i,               // Norwegian
  /\bnaisten\b/i,               // Finnish
  /\bdam(?:allsvenskan|er)?\b/i, // Swedish
  /\bkobiet\w*\b/i,             // Polish
  /\bzhenskaya\b/i,
  /\bnwsl\b/i,
  /\bwnba\b/i,
  /\bwsl\b/i,
  /\bw-?league\b/i,
  /\bwomen\b/i,
  /\(w\)/i,
  /\bfem\.?\b/i,
];

/** Age-group and reserve competitions, which mainstream books rarely price. */
const YOUTH_PATTERNS = [
  /\bu-?1[5-9]\b/i,
  /\bu-?2[0-3]\b/i,
  /\byouth\b/i,
  /\bjunior\w*\b/i,
  /\bprimavera\b/i,
  /\breserves?\b/i,
  /\bacadem(?:y|ia)\b/i,
  /\bdevelopment\b/i,
];

const FRIENDLY_PATTERNS = [/\bfriendl(?:y|ies)\b/i, /\bclub friendl/i];

/**
 * Strips diacritics before matching.
 *
 * Without this, "Division 1 Féminine" fails /\bfeminine\b/ because the accented
 * character breaks both the literal and the word boundary — silently dropping
 * most French, Spanish and Portuguese women's competitions.
 */
function normaliseName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** Competitions whose names carry no matchable gender word. */
const KNOWN_WOMENS_LEAGUES = [
  /^liga f$/i,
  /^a-?league women/i,
  /^toppserien$/i,
  /^kvindeligaen$/i,
  /^ekstraliga kobiet$/i,
  /^serie a1$/i,
];

function matchesAny(patterns, value) {
  const text = normaliseName(value);
  if (!text) return false;
  return patterns.some((pattern) => pattern.test(text));
}

/** Classifies a competition from its name. */
function classifyLeague(leagueName) {
  const name = normaliseName(leagueName).trim();
  return {
    womens:
      matchesAny(WOMENS_PATTERNS, leagueName) ||
      KNOWN_WOMENS_LEAGUES.some((pattern) => pattern.test(name)),
    youth: matchesAny(YOUTH_PATTERNS, leagueName),
    friendly: matchesAny(FRIENDLY_PATTERNS, leagueName),
  };
}

/** Dates in the coverage window, starting today (UTC). */
function coverageDates(from = new Date(), days = 1) {
  const count = Math.min(Math.max(Number(days) || 1, 1), 7);
  return Array.from({ length: count }, (_, offset) =>
    new Date(from.getTime() + offset * 86_400_000).toISOString().slice(0, 10),
  );
}

/**
 * Builds the coverage policy.
 *
 * @param {object} options
 * @param {boolean} options.includeWomens   Default true — women's competitions
 *   are first-class, not an add-on.
 * @param {boolean} options.includeYouth    Default false, matching what books carry.
 * @param {number[]} options.leagueAllowList Only these league ids, when non-empty.
 */
function createCoverage({
  days = 1,
  maxPages = 10,
  maxFixturesPerSport = 200,
  includeWomens = true,
  includeYouth = false,
  includeFriendlies = true,
  leagueAllowList = [],
  leagueBlockList = [],
  logger = console,
} = {}) {
  const allow = new Set(leagueAllowList.map(Number).filter(Number.isFinite));
  const block = new Set(leagueBlockList.map(Number).filter(Number.isFinite));

  const stats = { seen: 0, included: 0, womens: 0, excludedYouth: 0, excludedLeague: 0 };

  return {
    days,
    maxPages,
    maxFixturesPerSport,
    includeWomens,
    includeYouth,

    /** Whether this fixture's competition is in scope. */
    includeLeague(fixture) {
      stats.seen += 1;

      const id = Number(fixture?.leagueId);
      if (block.has(id)) {
        stats.excludedLeague += 1;
        return false;
      }
      if (allow.size > 0 && !allow.has(id)) {
        stats.excludedLeague += 1;
        return false;
      }

      const kind = classifyLeague(fixture?.league);

      if (kind.womens && !includeWomens) {
        stats.excludedLeague += 1;
        return false;
      }
      if (kind.youth && !includeYouth) {
        stats.excludedYouth += 1;
        return false;
      }
      if (kind.friendly && !includeFriendlies) {
        stats.excludedLeague += 1;
        return false;
      }

      stats.included += 1;
      if (kind.womens) stats.womens += 1;
      return true;
    },

    /** What the last sweep actually covered — surfaced on /api/meta. */
    snapshot() {
      return { ...stats };
    },

    reset() {
      for (const key of Object.keys(stats)) stats[key] = 0;
    },
  };
}

module.exports = {
  createCoverage,
  classifyLeague,
  normaliseName,
  coverageDates,
  WOMENS_PATTERNS,
  YOUTH_PATTERNS,
};
