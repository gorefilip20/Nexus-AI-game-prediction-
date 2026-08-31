'use strict';

const { getJson, ProviderError } = require('../http');
const { favourite, devig } = require('../odds');
const { createCoverage, coverageDates } = require('../coverage');

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
  // Optional QuotaManager. Without one the provider still works; it just has no
  // opinion about pacing, which is the behaviour the tests exercise.
  quotaManager = null,
  // undici dispatcher for outbound egress (a single static proxy, or direct).
  dispatcher = undefined,
  // Which competitions to cover. Defaults keep women's leagues in and youth out.
  coverage = createCoverage({ maxFixturesPerSport: fixturesPerSport }),
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

  /**
   * One upstream request.
   *
   * `priority` decides whether it is worth spending from today's allowance —
   * see quota.js. A refused low-priority call is not an error: the caller gets
   * an empty result and the cached value stands.
   */
  async function call(sport, path, params, { priority = 'normal' } = {}) {
    if (quotaManager) {
      const verdict = quotaManager.canSpend(sport, priority);
      if (!verdict.allowed) {
        throw new ProviderError(
          `Skipped ${sport} request: ${verdict.reason} (${verdict.remaining} left today)`,
          { status: null, retryable: false, quotaDeferred: true },
        );
      }
    }

    const { url, headers } = buildRequest(sport, path, params);
    const { body, headers: responseHeaders } = await getJson(url, {
      headers,
      timeoutMs,
      fetchImpl,
      logger,
      dispatcher,
      onRateLimited: (retryAfter) => quotaManager?.observeRateLimited(sport, retryAfter),
    });

    if (quotaManager) quotaManager.observeHeaders(sport, responseHeaders);

    const remaining = responseHeaders?.get?.('x-ratelimit-requests-remaining');
    if (remaining !== null && remaining !== undefined) {
      quota[sport] = { remaining: Number(remaining), checkedAt: now().toISOString() };
      if (Number(remaining) <= 5) {
        logger?.warn?.(`API-Sports ${sport} quota nearly exhausted (${remaining} left today)`);
      }
    }

    const rows = Array.isArray(body?.response) ? body.response : [];
    rows.paging = body?.paging ?? { current: 1, total: 1 };
    return rows;
  }

  /**
   * Walks every page of a paginated endpoint.
   *
   * Full coverage means whole-day fixture and odds listings, which the provider
   * pages at 100 items. `maxPages` bounds the walk so one enormous Saturday
   * cannot drain the daily allowance in a single call.
   */
  async function callPaged(sport, path, params, { priority = 'normal', maxPages = 10 } = {}) {
    const all = [];
    let page = 1;
    let totalPages = 1;

    while (page <= Math.min(totalPages, maxPages)) {
      let rows;
      try {
        rows = await call(sport, path, { ...params, page }, { priority });
      } catch (err) {
        // Page one failing is a real error; a later page failing still leaves
        // usable data, so keep what we have.
        if (page === 1) throw err;
        logger?.warn?.(`${sport} ${path} page ${page} failed: ${err.message}`);
        break;
      }

      all.push(...rows);
      totalPages = Number(rows.paging?.total) || 1;

      if (totalPages > maxPages && page === 1) {
        logger?.warn?.(
          `${sport} ${path} has ${totalPages} pages; fetching the first ${maxPages}. ` +
            'Raise COVERAGE_MAX_PAGES or narrow the league set for complete coverage.',
        );
      }

      page += 1;
    }

    return all;
  }

  /**
   * Every fixture for a sport across the coverage window.
   *
   * Date-based for all three sports rather than football's `next=N`: `next`
   * returns whichever fixtures happen to be chronologically closest worldwide,
   * which silently excludes most leagues — including nearly every women's
   * competition. A whole-day listing covers what a book covers.
   */
  async function fetchUpcoming(sport) {
    const spec = SPORTS[sport];
    const dates = coverageDates(now(), coverage.days);

    const collected = [];
    for (const date of dates) {
      const raw = await callPaged(
        sport,
        spec.listPath,
        { date, timezone: 'UTC' },
        { priority: 'normal', maxPages: coverage.maxPages },
      );
      collected.push(...raw.map(NORMALISERS[sport]));
    }

    const seen = new Set();
    const fixtures = collected
      .filter((f) => f.id && f.home && f.away)
      .filter((f) => {
        const key = `${f.sport}:${f.id}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .filter((f) => !f.status.finished)
      .filter((f) => coverage.includeLeague(f))
      .sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));

    if (fixtures.length > coverage.maxFixturesPerSport) {
      logger?.warn?.(
        `${sport}: ${fixtures.length} fixtures in the window, capping at ${coverage.maxFixturesPerSport}.`,
      );
    }

    return fixtures.slice(0, coverage.maxFixturesPerSport);
  }

  /**
   * Odds for a whole date in one paginated sweep, keyed by fixture id.
   *
   * This is what makes full coverage affordable: pricing 900 fixtures one call
   * at a time costs 900 requests, while the same board as a date sweep costs
   * about ten.
   */
  async function fetchOddsByDate(sport, date) {
    const rows = await callPaged(
      sport,
      '/odds',
      { date, bookmaker },
      { priority: 'normal', maxPages: coverage.maxPages },
    );

    const byFixture = new Map();
    for (const row of rows) {
      // Football nests the id under `fixture`, the v1 sports under `game`.
      const id = row?.fixture?.id ?? row?.game?.id ?? row?.id ?? null;
      if (id !== null) byFixture.set(String(id), row);
    }

    return byFixture;
  }

  /** Attaches devigged market probabilities; returns the slip either way. */
  async function attachOdds(fixture, oddsIndex = null) {
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
      // Prefer the day's bulk sweep; fall back to a single lookup only when a
      // fixture was not in it (a late addition, or a paging cut-off).
      let entry = oddsIndex?.get(String(fixture.id)) ?? null;

      if (!entry) {
        const raw = await cache.getOrSet(
          `odds:${fixture.sport}:${fixture.id}`,
          cacheTtl.oddsTtlMs ?? 15 * 60_000,
          () =>
            call(
              fixture.sport,
              '/odds',
              { [spec.oddsParam]: fixture.id, bookmaker },
              { priority: 'low' },
            ),
        );
        entry = raw.value?.[0] ?? null;
      }

      const moneyline = extractMoneyline(entry);
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
        // League history is the most expensive call and changes slowest.
        call(sport, SPORTS[sport].listPath, { league: leagueId, season }, { priority: 'low' }),
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

        const sport = SPORT_NAMES[i];
        const fixtures = outcome.value.fixtures;

        // One sweep prices the whole day; without it a 900-fixture board would
        // cost 900 requests.
        let oddsIndex = null;
        try {
          const swept = await cache.getOrSet(
            `oddsday:${sport}:${coverageDates(now(), 1)[0]}`,
            cacheTtl.oddsTtlMs ?? 15 * 60_000,
            () => fetchOddsByDate(sport, coverageDates(now(), 1)[0]),
          );
          oddsIndex = swept.value;
        } catch (err) {
          logger?.warn?.(`Bulk odds sweep failed for ${sport}: ${err.message}`);
          degraded.push({ sport, error: `odds sweep unavailable (${err.message})` });
        }

        slips.push(...(await Promise.all(fixtures.map((f) => attachOdds(f, oddsIndex)))));
      }

      return {
        provider: 'api-sports',
        live: true,
        fetchedAt: now().toISOString(),
        quota,
        degraded,
        coverage: coverage.snapshot(),
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
              // Settlement: a finished fixture must be graded today.
              () => call(sport, SPORTS[sport].listPath, { id }, { priority: 'critical' }),
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
    getQuotaDetail: () => quotaManager?.snapshotAll() ?? null,
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
