'use strict';

const { getJson, ProviderError } = require('../http');
const { favourite, devig } = require('../odds');

/**
 * API-Sports ships one API per sport on its own host, sharing an auth scheme and
 * an envelope of `{ get, parameters, errors, results, paging, response }`.
 * Football (v3) nests fixture metadata under `fixture`; basketball and
 * volleyball (v1) keep it flat on the game object. The normalisers below absorb
 * that difference so the rest of the app sees one shape.
 */
const SPORTS = {
  football: {
    host: 'v3.football.api-sports.io',
    rapidHost: 'api-football-v1.p.rapidapi.com',
    listPath: '/fixtures',
    oddsParam: 'fixture',
    supportsNext: true,
    drawPossible: true,
  },
  basketball: {
    host: 'v1.basketball.api-sports.io',
    rapidHost: 'api-basketball.p.rapidapi.com',
    listPath: '/games',
    oddsParam: 'game',
    supportsNext: false,
    drawPossible: false,
  },
  volleyball: {
    host: 'v1.volleyball.api-sports.io',
    rapidHost: 'api-volleyball.p.rapidapi.com',
    listPath: '/games',
    oddsParam: 'game',
    supportsNext: false,
    drawPossible: false,
  },
};

const SPORT_NAMES = Object.keys(SPORTS);

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'AOT', 'AP', 'ENDED', 'POST_ET']);
const NOT_STARTED_STATUSES = new Set(['NS', 'TBD', 'SCHEDULED']);

/** Matches the moneyline market across sports: "Match Winner", "Home/Away", "Winner". */
const MONEYLINE_PATTERN = /^(match\s*winner|home\/away|winner|match\s*result|1x2)$/i;
const OUTCOME_LABELS = { home: 'Home', draw: 'Draw', away: 'Away', '1': 'Home', x: 'Draw', '2': 'Away' };

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Volleyball reports set counts as bare numbers while basketball nests a
 * `{ total }` object, so accept either without guessing per sport.
 */
function readScore(side) {
  if (side === null || side === undefined) return null;
  if (typeof side === 'object') return toNumberOrNull(side.total ?? side.points ?? side.score);
  return toNumberOrNull(side);
}

function utcDateString(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function normaliseStatus(raw) {
  const short = String(raw?.short ?? raw?.status ?? '').toUpperCase();
  return {
    short,
    long: raw?.long ?? raw?.status ?? null,
    finished: FINISHED_STATUSES.has(short),
    notStarted: NOT_STARTED_STATUSES.has(short),
  };
}

/** Football v3 fixture -> common shape. */
function normaliseFootball(item) {
  const fixture = item?.fixture ?? {};
  const league = item?.league ?? {};
  const teams = item?.teams ?? {};

  return {
    sport: 'football',
    id: fixture.id ?? null,
    leagueId: league.id ?? null,
    league: league.name ?? null,
    country: league.country ?? null,
    season: league.season ?? null,
    round: league.round ?? null,
    home: teams.home?.name ?? null,
    away: teams.away?.name ?? null,
    kickoff: fixture.date ?? null,
    timestamp: fixture.timestamp ?? null,
    status: normaliseStatus(fixture.status),
    homeScore: readScore(item?.goals?.home),
    awayScore: readScore(item?.goals?.away),
  };
}

/** Basketball / volleyball v1 game -> common shape. */
function normaliseFlatGame(sport) {
  return (item) => {
    const league = item?.league ?? {};
    const teams = item?.teams ?? {};
    const country = item?.country ?? league.country ?? {};

    return {
      sport,
      id: item?.id ?? null,
      leagueId: league.id ?? null,
      league: league.name ?? null,
      country: typeof country === 'string' ? country : (country?.name ?? null),
      season: league.season ?? null,
      round: item?.stage ?? item?.week ?? null,
      home: teams.home?.name ?? null,
      away: teams.away?.name ?? null,
      kickoff: item?.date ?? null,
      timestamp: item?.timestamp ?? null,
      status: normaliseStatus(item?.status),
      homeScore: readScore(item?.scores?.home),
      awayScore: readScore(item?.scores?.away),
    };
  };
}

const NORMALISERS = {
  football: normaliseFootball,
  basketball: normaliseFlatGame('basketball'),
  volleyball: normaliseFlatGame('volleyball'),
};

/**
 * Pulls the moneyline outcomes out of an odds payload.
 * Falls back to the first bookmaker offering a recognisable market.
 */
function extractMoneyline(oddsEntry) {
  const bookmakers = oddsEntry?.bookmakers ?? [];

  for (const bookmaker of bookmakers) {
    for (const bet of bookmaker?.bets ?? []) {
      if (!MONEYLINE_PATTERN.test(String(bet?.name ?? '').trim())) continue;

      const outcomes = [];
      for (const value of bet?.values ?? []) {
        const key = String(value?.value ?? '').trim().toLowerCase();
        const label = OUTCOME_LABELS[key];
        const odd = toNumberOrNull(value?.odd);
        if (label && odd) outcomes.push({ label, odd });
      }

      if (outcomes.length >= 2) {
        return { bookmaker: bookmaker.name ?? null, market: bet.name, outcomes };
      }
    }
  }

  return null;
}

/** Turns a devigged favourite into the wording the dashboard shows. */
function describePick(fixture, pick) {
  if (pick.label === 'Draw') return 'Draw';
  const team = pick.label === 'Home' ? fixture.home : fixture.away;
  return team ? `${team} to Win` : `${pick.label} to Win`;
}

function buildReference(fixture) {
  const prefix = fixture.sport.slice(0, 2).toUpperCase();
  return `NB-${prefix}-${fixture.id}`;
}

function createApiSportsProvider({
  key,
  mode = 'direct',
  timeoutMs = 10_000,
  fixturesPerSport = 3,
  bookmaker = null,
  cache,
  cacheTtl = {},
  fetchImpl = globalThis.fetch,
  logger = console,
  now = () => new Date(),
} = {}) {
  if (!key) throw new ProviderError('API_SPORTS_KEY is required for the api-sports provider');

  const quota = {};

  function buildRequest(sport, path, params) {
    const spec = SPORTS[sport];
    if (!spec) throw new ProviderError(`Unsupported sport: ${sport}`);

    const isRapid = mode === 'rapidapi';
    const host = isRapid ? spec.rapidHost : spec.host;
    // RapidAPI fronts the football API under a /v3 prefix; the others sit at root.
    const prefix = isRapid && sport === 'football' ? '/v3' : '';
    const url = new URL(`https://${host}${prefix}${path}`);

    for (const [name, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== '') {
        url.searchParams.set(name, String(value));
      }
    }

    const headers = isRapid
      ? { 'x-rapidapi-key': key, 'x-rapidapi-host': host }
      : { 'x-apisports-key': key };

    return { url: url.toString(), headers };
  }

  async function call(sport, path, params) {
    const { url, headers } = buildRequest(sport, path, params);
    const { body, headers: responseHeaders } = await getJson(url, {
      headers,
      timeoutMs,
      fetchImpl,
      logger,
    });

    const remaining = responseHeaders?.get?.('x-ratelimit-requests-remaining');
    if (remaining !== null && remaining !== undefined) {
      quota[sport] = { remaining: Number(remaining), checkedAt: now().toISOString() };
      if (Number(remaining) <= 5) {
        logger?.warn?.(`API-Sports ${sport} quota nearly exhausted (${remaining} left today)`);
      }
    }

    return Array.isArray(body?.response) ? body.response : [];
  }

  /** Upcoming fixtures for one sport, newest kickoff first. */
  async function fetchUpcoming(sport) {
    const spec = SPORTS[sport];
    const params = spec.supportsNext
      ? { next: fixturesPerSport, timezone: 'UTC' }
      : { date: utcDateString(now()), timezone: 'UTC' };

    const raw = await call(sport, spec.listPath, params);
    const normalised = raw.map(NORMALISERS[sport]).filter((f) => f.id && f.home && f.away);

    // The date-based endpoints return the whole day including finished games.
    const upcoming = normalised.filter((f) => !f.status.finished);
    const ordered = (upcoming.length ? upcoming : normalised).sort(
      (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
    );

    return ordered.slice(0, fixturesPerSport);
  }

  /** Attaches devigged market probabilities; returns the slip either way. */
  async function attachOdds(fixture) {
    const spec = SPORTS[fixture.sport];
    const base = {
      ...fixture,
      ref: buildReference(fixture),
      prediction: null,
      pickLabel: null,
      probability: null,
      odd: null,
      bookmaker: null,
      market: null,
      marketOutcomes: [],
      overround: null,
      oddsAvailable: false,
      source: 'market-odds',
    };

    try {
      const raw = await cache.getOrSet(
        `odds:${fixture.sport}:${fixture.id}`,
        cacheTtl.oddsTtlMs ?? 15 * 60_000,
        () => call(fixture.sport, '/odds', { [spec.oddsParam]: fixture.id, bookmaker }),
      );

      const moneyline = extractMoneyline(raw.value?.[0]);
      if (!moneyline) return base;

      const pick = favourite(moneyline.outcomes);
      if (!pick) return base;

      // Keep the whole ladder, devigged: the insight generator needs every
      // outcome's fair price to compute expected value, not just the favourite.
      const fair = devig(moneyline.outcomes.map((o) => o.odd));
      const marketOutcomes = moneyline.outcomes.map((o, i) => ({
        label: o.label,
        odd: o.odd,
        impliedProbability: fair ? Math.round(fair[i] * 1000) / 10 : null,
      }));

      return {
        ...base,
        prediction: describePick(fixture, pick),
        pickLabel: pick.label,
        probability: Math.round(pick.probability * 1000) / 10,
        odd: pick.odd,
        bookmaker: moneyline.bookmaker,
        market: moneyline.market,
        marketOutcomes,
        overround: pick.overround ? Math.round(pick.overround * 1000) / 1000 : null,
        oddsAvailable: true,
      };
    } catch (err) {
      // Odds are frequently absent for minor competitions. That is not a reason
      // to drop a real fixture from the board.
      logger?.warn?.(`No odds for ${fixture.sport} ${fixture.id}: ${err.message}`);
      return base;
    }
  }

  return {
    name: 'api-sports',
    live: true,
    sports: SPORT_NAMES,

    /** Adds devigged market odds to fixtures the caller located itself. */
    async priceFixtures(fixtures) {
      return Promise.all(fixtures.map(attachOdds));
    },

    /** Every fixture on a given date, unfiltered — used by search and the CLI. */
    async listFixturesByDate(sport, date) {
      if (!SPORTS[sport]) return [];
      const raw = await call(sport, SPORTS[sport].listPath, {
        date: date ?? utcDateString(now()),
        timezone: 'UTC',
      });
      return raw.map(NORMALISERS[sport]).filter((f) => f.id && f.home && f.away);
    },

    /**
     * Finished fixtures for one league-season, used to fit the probability
     * models. Cached hard: results only change when matches end, and this is the
     * single most quota-expensive call in the app.
     */
    async getHistory(sport, leagueId, season) {
      if (!SPORTS[sport] || !leagueId || !season) return [];

      const key = `history:${sport}:${leagueId}:${season}`;
      const cached = await cache.getOrSet(key, cacheTtl.historyTtlMs ?? 6 * 3600_000, () =>
        call(sport, SPORTS[sport].listPath, { league: leagueId, season }),
      );

      return cached.value.map(NORMALISERS[sport]).filter((f) => f.status.finished);
    },

    /** Slips for every sport. One sport failing does not take down the board. */
    async getSlips() {
      const settled = await Promise.allSettled(
        SPORT_NAMES.map(async (sport) => {
          const fixtures = await cache.getOrSet(
            `fixtures:${sport}`,
            cacheTtl.fixturesTtlMs ?? 5 * 60_000,
            () => fetchUpcoming(sport),
          );
          return { sport, fixtures: fixtures.value, stale: fixtures.stale };
        }),
      );

      const slips = [];
      const degraded = [];

      for (let i = 0; i < settled.length; i += 1) {
        const outcome = settled[i];
        if (outcome.status === 'rejected') {
          degraded.push({ sport: SPORT_NAMES[i], error: outcome.reason.message });
          continue;
        }
        if (outcome.value.stale) degraded.push({ sport: SPORT_NAMES[i], error: 'serving cached data' });
        slips.push(...(await Promise.all(outcome.value.fixtures.map(attachOdds))));
      }

      return {
        provider: 'api-sports',
        live: true,
        fetchedAt: now().toISOString(),
        quota,
        degraded,
        slips,
      };
    },

    /** Finished results for recorded picks, keyed as `${sport}:${id}`. */
    async getResults(references) {
      const bySport = new Map();
      for (const { sport, id } of references) {
        if (!SPORTS[sport]) continue;
        if (!bySport.has(sport)) bySport.set(sport, []);
        bySport.get(sport).push(id);
      }

      const results = new Map();

      for (const [sport, ids] of bySport) {
        for (const id of ids) {
          try {
            const raw = await cache.getOrSet(
              `result:${sport}:${id}`,
              cacheTtl.resultsTtlMs ?? 10 * 60_000,
              () => call(sport, SPORTS[sport].listPath, { id }),
            );
            const fixture = raw.value.map(NORMALISERS[sport])[0];
            if (fixture?.status?.finished) results.set(`${sport}:${id}`, fixture);
          } catch (err) {
            logger?.warn?.(`Could not settle ${sport} ${id}: ${err.message}`);
          }
        }
      }

      return results;
    },

    getQuota: () => ({ ...quota }),
  };
}

module.exports = {
  createApiSportsProvider,
  SPORTS,
  SPORT_NAMES,
  normaliseFootball,
  normaliseFlatGame,
  extractMoneyline,
  describePick,
  readScore,
  normaliseStatus,
  buildReference,
};
