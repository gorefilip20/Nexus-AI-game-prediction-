'use strict';

/** Parses an integer env var, falling back when unset or malformed. */
function intFromEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const apiSportsKey = (process.env.API_SPORTS_KEY ?? '').trim();

/**
 * `api-sports` is the only affordable provider covering football, basketball and
 * volleyball behind one key, so it is the default. With no key present we fall
 * back to the bundled sample provider rather than booting a dead dashboard.
 */
const providerName =
  (process.env.SPORTS_PROVIDER ?? '').trim() || (apiSportsKey ? 'api-sports' : 'sample');

const config = {
  port: intFromEnv('PORT', 5000),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',

  provider: providerName,
  apiSports: {
    key: apiSportsKey,
    // 'direct' uses *.api-sports.io with x-apisports-key.
    // 'rapidapi' routes through RapidAPI with x-rapidapi-key + x-rapidapi-host.
    mode: (process.env.API_SPORTS_MODE ?? 'direct').trim(),
    timeoutMs: intFromEnv('API_SPORTS_TIMEOUT_MS', 10_000),
    // Each fixture costs one extra request for odds, so keep the default small
    // enough to sit inside the 100 requests/day free tier.
    fixturesPerSport: intFromEnv('FIXTURES_PER_SPORT', 3),
    // Restricting to one bookmaker keeps odds payloads small and comparable.
    bookmaker: (process.env.API_SPORTS_BOOKMAKER ?? '').trim() || null,
  },

  cache: {
    fixturesTtlMs: intFromEnv('CACHE_FIXTURES_TTL_MS', 5 * 60_000),
    oddsTtlMs: intFromEnv('CACHE_ODDS_TTL_MS', 15 * 60_000),
    resultsTtlMs: intFromEnv('CACHE_RESULTS_TTL_MS', 10 * 60_000),
    historyTtlMs: intFromEnv('CACHE_HISTORY_TTL_MS', 6 * 3600_000),
  },

  // The probability engine costs one history request per league-season per
  // refresh window. Disable it to run the board on odds alone.
  modelEnabled: (process.env.MODEL_ENABLED ?? 'true').toLowerCase() !== 'false',

  ledgerPath: process.env.LEDGER_PATH ?? null,
  settlementIntervalMs: intFromEnv('SETTLEMENT_INTERVAL_MS', 15 * 60_000),
};

module.exports = { config, intFromEnv };
