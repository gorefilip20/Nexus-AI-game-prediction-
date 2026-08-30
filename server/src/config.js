'use strict';

/** Parses a positive integer env var, falling back when unset or malformed. */
function intFromEnv(name, fallback) {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function boolFromEnv(name, fallback = false) {
  const raw = (process.env[name] ?? '').trim().toLowerCase();
  if (raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes';
}

/** CORS origins as a list; a bare "*" is preserved so validation can reject it. */
function originsFromEnv(name, fallback) {
  const raw = (process.env[name] ?? '').trim();
  if (!raw) return fallback;
  if (raw === '*') return '*';
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const nodeEnv = (process.env.NODE_ENV ?? 'development').trim();
const isProduction = nodeEnv === 'production';
const apiSportsKey = (process.env.API_SPORTS_KEY ?? '').trim();

/**
 * `api-sports` is the only affordable provider covering football, basketball and
 * volleyball behind one key, so it is the default. With no key present we fall
 * back to the bundled sample provider rather than booting a dead dashboard.
 */
const providerName =
  (process.env.SPORTS_PROVIDER ?? '').trim() || (apiSportsKey ? 'api-sports' : 'sample');

const config = {
  nodeEnv,
  isProduction,

  port: intFromEnv('PORT', 5000),
  host: process.env.HOST ?? '0.0.0.0',
  corsOrigin: originsFromEnv('CORS_ORIGIN', ['http://localhost:5173']),
  trustProxy: boolFromEnv('TRUST_PROXY', false),
  serveClient: boolFromEnv('SERVE_CLIENT', false),

  rateLimit: {
    max: intFromEnv('RATE_LIMIT_MAX', 120),
    timeWindow: (process.env.RATE_LIMIT_WINDOW ?? '1 minute').trim(),
  },

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
  modelEnabled: boolFromEnv('MODEL_ENABLED', true),

  ledgerPath: (process.env.LEDGER_PATH ?? '').trim() || null,
  settlementIntervalMs: intFromEnv('SETTLEMENT_INTERVAL_MS', 15 * 60_000),
};

/**
 * Checks the configuration is safe to serve.
 *
 * Returns `errors` (fatal in production) and `warnings` (always advisory), so a
 * misconfigured deploy fails at boot rather than at the first request — or,
 * worse, silently serves sample data to real users.
 */
function validateConfig(cfg = config) {
  const errors = [];
  const warnings = [];

  if (cfg.isProduction) {
    if (cfg.corsOrigin === '*') {
      errors.push(
        'CORS_ORIGIN is "*" in production. Set it to your real origin(s), comma-separated.',
      );
    }

    // Sample data in production would present demo fixtures as if they were
    // live. Running it must be a deliberate, explicit choice.
    if (cfg.provider === 'sample' && (process.env.SPORTS_PROVIDER ?? '').trim() !== 'sample') {
      errors.push(
        'No API_SPORTS_KEY is set, so the app would serve sample data in production. ' +
          'Set API_SPORTS_KEY, or set SPORTS_PROVIDER=sample to state that you mean it.',
      );
    }

    if (cfg.provider === 'api-sports' && !cfg.apiSports.key) {
      errors.push('SPORTS_PROVIDER=api-sports requires API_SPORTS_KEY.');
    }

    if (!['direct', 'rapidapi'].includes(cfg.apiSports.mode)) {
      errors.push(`API_SPORTS_MODE must be "direct" or "rapidapi", got "${cfg.apiSports.mode}".`);
    }

    if (!cfg.ledgerPath) {
      warnings.push(
        'LEDGER_PATH is unset, so settled picks are written to container-local disk ' +
          'and will be lost on restart. Point it at a mounted volume.',
      );
    }

    if (!cfg.trustProxy) {
      warnings.push(
        'TRUST_PROXY is false. Behind a load balancer, rate limiting will see the ' +
          'proxy IP for every request and throttle all users as one.',
      );
    }
  }

  if (cfg.port < 1 || cfg.port > 65_535) {
    errors.push(`PORT must be between 1 and 65535, got ${cfg.port}.`);
  }

  // A VITE_-prefixed secret is inlined into the browser bundle and served to
  // every visitor, so treat it as a leak wherever it is found.
  for (const name of Object.keys(process.env)) {
    if (!name.startsWith('VITE_')) continue;
    if (/KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL|CREDENTIAL/i.test(name)) {
      errors.push(
        `${name} is exposed to the browser bundle by its VITE_ prefix. ` +
          'Move it to a server-side variable without that prefix.',
      );
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** Throws on a fatal misconfiguration; logs warnings. */
function assertValidConfig(cfg = config, logger = console) {
  const { ok, errors, warnings } = validateConfig(cfg);

  for (const warning of warnings) logger?.warn?.(`config: ${warning}`);

  if (!ok) {
    const detail = errors.map((e) => `  - ${e}`).join('\n');
    throw new Error(`Invalid configuration:\n${detail}`);
  }

  return { errors, warnings };
}

module.exports = { config, validateConfig, assertValidConfig, intFromEnv, boolFromEnv };
