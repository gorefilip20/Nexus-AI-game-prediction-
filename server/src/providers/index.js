'use strict';

const { config } = require('../config');
const { TtlCache } = require('../cache');
const { createApiSportsProvider } = require('./apiSports');
const { createSampleProvider } = require('./sample');

/**
 * Builds the configured provider. Adding another feed means adding a factory
 * here that satisfies the same getSlips/getResults contract — nothing outside
 * this directory knows which vendor is in use.
 */
function createProvider({ logger = console, fetchImpl = globalThis.fetch, cache } = {}) {
  const sharedCache = cache ?? new TtlCache();

  if (config.provider === 'api-sports') {
    if (!config.apiSports.key) {
      logger?.warn?.(
        'SPORTS_PROVIDER=api-sports but API_SPORTS_KEY is empty — falling back to sample data.',
      );
      return createSampleProvider();
    }

    return createApiSportsProvider({
      key: config.apiSports.key,
      mode: config.apiSports.mode,
      timeoutMs: config.apiSports.timeoutMs,
      fixturesPerSport: config.apiSports.fixturesPerSport,
      bookmaker: config.apiSports.bookmaker,
      cache: sharedCache,
      cacheTtl: config.cache,
      fetchImpl,
      logger,
    });
  }

  if (config.provider !== 'sample') {
    logger?.warn?.(`Unknown SPORTS_PROVIDER "${config.provider}" — falling back to sample data.`);
  }

  return createSampleProvider();
}

module.exports = { createProvider };
