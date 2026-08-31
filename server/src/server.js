'use strict';

const path = require('node:path');
const fs = require('node:fs');

const { LogController } = require('fastify');

const { config, assertValidConfig } = require('./config');
const { sampleTrackerSummary } = require('./data');
const { createProvider } = require('./providers');
const { buildBoard } = require('./board');
const { searchFixtures } = require('./search');
const { PredictionLedger, DEFAULT_PATH } = require('./ledger');
const { PunterLounge } = require('./lounge');
const { createNotifier, createChannelsFromConfig } = require('./notify');
const { BoardSnapshot, isBudgetExhaustion } = require('./snapshot');

const CLIENT_DIST = path.resolve(__dirname, '..', '..', 'client', 'dist');

/**
 * Production logs go to stdout as JSON for the platform's log collector.
 * Authorization headers and provider keys are redacted so a credential can
 * never reach a log aggregator.
 */
function buildLoggerOptions() {
  const redact = {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-apisports-key"]',
      'req.headers["x-rapidapi-key"]',
    ],
    remove: true,
  };

  const level = process.env.LOG_LEVEL ?? 'info';
  if (!config.isProduction) return { level, redact };

  return {
    level,
    redact,
    // The request id is enough to correlate; full headers bloat every line.
    serializers: {
      req: (req) => ({ method: req.method, url: req.url, remoteAddress: req.ip }),
    },
  };
}

/**
 * Builds a configured Fastify instance.
 *
 * Plugin registration is awaited before any route is defined. Fastify binds
 * hooks to a route when that route is registered, so a plugin left to load
 * later (a bare `register()` followed by synchronous `get()` calls) attaches
 * its hooks to nothing — compression and rate limiting silently do not run.
 * Awaiting here is what makes them actually take effect.
 */
async function buildServer({ logger = buildLoggerOptions() } = {}) {
  const app = require('fastify')({
    logger,
    // Behind a load balancer the socket address is the proxy's. Without this,
    // rate limiting buckets every user together and logs record the wrong IP.
    trustProxy: config.trustProxy,
    // Per-request access logs duplicate what the platform's proxy records and
    // dominate log volume at scale.
    logController: new LogController({ disableRequestLogging: config.isProduction }),
  });

  const lounge = new PunterLounge({ logger: app.log });
  const provider = createProvider({ logger: app.log });
  const ledger = new PredictionLedger({
    filePath: config.ledgerPath ?? DEFAULT_PATH,
    logger: app.log,
  });

  // Continuity buffer: the last good board, served when the budget is spent.
  const snapshot = new BoardSnapshot({ logger: app.log });

  const notifier = createNotifier({
    channels: createChannelsFromConfig(config.notifications, { logger: app.log }),
    statuses: config.notifications.statuses,
    logger: app.log,
  });

  if (notifier.enabled) {
    app.log.info(
      `Settlement notifications enabled via ${notifier.channelNames.join(', ')} for ${notifier.statuses.join('/')}`,
    );
  }

  await app.register(require('@fastify/helmet'), {
    // The SPA loads only its own bundle. Styles need inline because Tailwind's
    // custom properties and the base reset are applied that way.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        // Same-origin XHR plus the punter-lounge WebSocket.
        connectSrc: ["'self'", 'ws:', 'wss:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'self'"],
      },
    },
    // Only meaningful over HTTPS; the platform terminates TLS.
    hsts: config.isProduction ? { maxAge: 15_552_000, includeSubDomains: true } : false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(require('@fastify/compress'), {
    global: true,
    encodings: ['br', 'gzip', 'deflate'],
    // Below this, framing costs more than the compression saves.
    threshold: 1024,
  });

  await app.register(require('@fastify/rate-limit'), {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.timeWindow,
    // Health checks come from the load balancer on a fixed schedule; throttling
    // them would make the platform think the app is down.
    allowList: (request) => request.url === '/api/health',
    keyGenerator: (request) => request.ip,
  });

  await app.register(require('@fastify/cors'), { origin: config.corsOrigin });
  await app.register(require('@fastify/websocket'));

  /**
   * Loads the board and, for a live provider, writes every priced pick into the
   * ledger. Recording on read keeps the tracker honest without a separate
   * scheduler: a pick is only ever graded if it was actually shown.
   */
  async function loadBoard() {
    try {
      const board = await buildBoard({
        provider,
        logger: app.log,
        modelEnabled: config.modelEnabled,
        minConfidence: config.minConfidence,
      });

      // A board with no slips is a degraded result, not a good one: keeping it
      // would overwrite a usable snapshot with an empty screen.
      if (board.slips.length > 0) {
        snapshot.store(board);

        if (provider.live) {
          await ledger.load();
          if (ledger.record(board.slips) > 0) await ledger.save();
        }

        return board;
      }

      const cached = snapshot.read('no fixtures returned by the provider');
      if (cached) {
        app.log.warn('Serving the cached board: the provider returned no fixtures.');
        return cached;
      }

      return board;
    } catch (err) {
      const reason = isBudgetExhaustion(err)
        ? 'the daily request budget is spent; live updates resume at 00:00 UTC'
        : `live data unavailable (${err.message})`;

      const cached = snapshot.read(reason);
      if (cached) {
        app.log.warn(`Serving the cached board: ${reason}`);
        return cached;
      }

      // Nothing cached yet — the caller reports the failure honestly rather
      // than inventing a board.
      throw err;
    }
  }

  /** Grades every pending pick whose fixture has finished. */
  async function runSettlement() {
    if (!provider.live) return { settled: 0 };

    await ledger.load();
    const pending = ledger.pendingReferences();
    if (pending.length === 0) return { settled: 0 };

    const results = await provider.getResults(pending);
    const { settled } = ledger.settle(results);

    if (settled > 0) {
      await ledger.save();
      app.log.info(`Settled ${settled} prediction(s).`);
    }

    // Notify on everything still undelivered, not just this pass's entries: a
    // channel outage during an earlier pass would otherwise lose those cards.
    let notified = { sent: 0, failed: 0 };
    if (notifier.enabled) {
      const pendingCards = ledger.unnotified(notifier.statuses);
      if (pendingCards.length > 0) {
        notified = await notifier.notifySettled(pendingCards, ledger.summary());
        // notifiedAt is written onto the entries, so persist the acknowledgement.
        if (notified.sent > 0) await ledger.save();
      }
    }

    return { settled, notified: { sent: notified.sent, failed: notified.failed } };
  }

  app.get('/api/health', async () => ({
    status: 'ok',
    online: lounge.size,
    provider: provider.name,
    live: provider.live,
    uptime: process.uptime(),
  }));

  app.get('/api/meta', async () => ({
    provider: provider.name,
    live: provider.live,
    sports: provider.sports,
    quota: provider.getQuota(),
    // Per-sport budget state: limit, remaining, pacing line and any active
    // rate-limit pause. This is the signal to watch for 24/7 continuity.
    quotaDetail: provider.getQuotaDetail?.() ?? null,
    egress: config.egress.proxyUrl ? 'static proxy' : 'direct',
    snapshot: snapshot.describe(),
    coverage: {
      days: config.coverage.days,
      includeWomens: config.coverage.includeWomens,
      includeYouth: config.coverage.includeYouth,
      maxFixturesPerSport: config.coverage.maxFixturesPerSport,
    },
    minConfidence: config.minConfidence,
    notifications: {
      enabled: notifier.enabled,
      channels: notifier.channelNames,
      statuses: notifier.statuses,
    },
    modelEnabled: config.modelEnabled,
    settlementIntervalMs: config.settlementIntervalMs,
  }));

  app.get('/api/predictions', async (request, reply) => {
    try {
      const board = await loadBoard();
      return {
        provider: board.provider,
        live: board.live,
        sampleData: board.sampleData ?? false,
        fetchedAt: board.fetchedAt,
        degraded: board.degraded,
        modelEnabled: board.modelEnabled,
        modelNotes: board.modelNotes ?? [],
        minConfidence: board.minConfidence ?? 0,
        highConfidenceCount: board.highConfidenceCount ?? 0,
        coverage: board.coverage ?? null,
        quota: board.quota,
        // Set when this response came from the continuity buffer rather than a
        // fresh fetch, with how old it is and when live updates resume.
        stale: board.stale ?? false,
        staleReason: board.staleReason ?? null,
        cachedAt: board.cachedAt ?? null,
        ageSeconds: board.ageSeconds ?? null,
        liveUpdatesResumeAt: board.liveUpdatesResumeAt ?? null,
        predictions: board.slips,
      };
    } catch (err) {
      app.log.error({ err }, 'Failed to load prediction board');
      return reply.code(502).send({
        error: 'provider_unavailable',
        message: err.message,
        provider: provider.name,
      });
    }
  });

  app.get('/api/search', async (request, reply) => {
    const { q, sport, days, limit } = request.query ?? {};

    try {
      return await searchFixtures({
        provider,
        query: q,
        sport: sport || null,
        days: days ?? 2,
        limit: limit ?? 12,
        logger: app.log,
        modelEnabled: config.modelEnabled,
      });
    } catch (err) {
      app.log.error({ err }, 'Search failed');
      return reply.code(502).send({ error: 'search_failed', message: err.message });
    }
  });

  app.get('/api/tracker', async (request, reply) => {
    if (!provider.live) return sampleTrackerSummary();

    try {
      await ledger.load();
      return ledger.summary();
    } catch (err) {
      app.log.error({ err }, 'Failed to read the prediction ledger');
      return reply.code(500).send({ error: 'ledger_unavailable', message: err.message });
    }
  });

  app.post('/api/settle', async (request, reply) => {
    try {
      return await runSettlement();
    } catch (err) {
      app.log.error({ err }, 'Settlement pass failed');
      return reply.code(502).send({ error: 'settlement_failed', message: err.message });
    }
  });

  await app.register(async function loungeRoutes(instance) {
    instance.get('/ws/punter-lounge', { websocket: true }, (connection) => {
      // @fastify/websocket v11 hands the raw socket to the handler; older
      // releases wrapped it as `connection.socket`. Support both.
      const socket = connection.socket ?? connection;

      lounge.add(socket);

      socket.on('message', (messageBuffer) => {
        try {
          lounge.handleIncoming(socket, messageBuffer);
        } catch (err) {
          app.log.error({ err }, 'Failed to process lounge message');
        }
      });

      socket.on('error', (err) => {
        app.log.error({ err }, 'Lounge socket error');
      });

      socket.on('close', () => lounge.remove(socket));
    });
  });

  // Registered last so the SPA fallback can never shadow an API route.
  if (config.serveClient) {
    if (fs.existsSync(path.join(CLIENT_DIST, 'index.html'))) {
      await app.register(require('@fastify/static'), {
        root: CLIENT_DIST,
        // Hashed asset filenames are safe to cache immutably; index.html is not.
        maxAge: '1y',
        immutable: true,
        index: false,
      });

      // index.html is served explicitly rather than by the static plugin's own
      // index handling: it must NOT inherit the immutable one-year cache used
      // for hashed assets, or returning visitors would never see a new deploy.
      // `cacheControl: false` stops sendFile applying the plugin's immutable
      // one-year policy to this response; without it index.html inherits the
      // hashed-asset cache and a returning visitor never sees a new deploy.
      const sendIndex = (request, reply) =>
        reply
          .header('cache-control', 'no-cache, must-revalidate')
          .sendFile('index.html', { cacheControl: false });

      // Without this, a request for "/" reaches the static plugin as a
      // directory request and is refused with 403 before any fallback runs.
      app.get('/', sendIndex);

      app.setNotFoundHandler((request, reply) => {
        if (request.url.startsWith('/api') || request.url.startsWith('/ws')) {
          return reply.code(404).send({ error: 'not_found' });
        }
        return sendIndex(request, reply);
      });

      app.log.info(`Serving client build from ${CLIENT_DIST}`);
    } else {
      app.log.error(
        `SERVE_CLIENT=true but no build found at ${CLIENT_DIST}. Run "npm run build" first.`,
      );
    }
  }

  // Exposed for the start/shutdown path and for tests driving the app directly.
  app.decorate('nexus', { lounge, provider, ledger, notifier, snapshot, runSettlement, loadBoard });

  return app;
}

/**
 * Boots the server and installs signal handlers.
 *
 * Graceful shutdown matters under a process manager: on redeploy the platform
 * sends SIGTERM, and draining in-flight requests and closing sockets cleanly is
 * what turns a restart into a non-event rather than a burst of 502s.
 */
async function startServer() {
  let app;

  try {
    assertValidConfig(config, console);
    app = await buildServer();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }

  const { lounge, provider } = app.nexus;
  let settlementTimer = null;

  const shutdown = async (signal) => {
    app.log.info(`Received ${signal}, shutting down.`);
    lounge.stop();
    if (settlementTimer) clearInterval(settlementTimer);

    try {
      await app.close();
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      shutdown(signal).catch(() => process.exit(1));
    });
  }

  // A process manager restarts on a non-zero exit, so surface the reason and
  // let it. Continuing after an unhandled rejection leaves unknown state.
  process.on('unhandledRejection', (reason) => {
    app.log.fatal({ err: reason }, 'Unhandled rejection — exiting for restart');
    process.exit(1);
  });

  process.on('uncaughtException', (err) => {
    app.log.fatal({ err }, 'Uncaught exception — exiting for restart');
    process.exit(1);
  });

  try {
    lounge.start();

    if (provider.live) {
      settlementTimer = setInterval(() => {
        app.nexus.runSettlement().catch((err) =>
          app.log.error({ err }, 'Scheduled settlement failed'),
        );
      }, config.settlementIntervalMs);
      settlementTimer.unref?.();
    } else {
      app.log.warn(
        'Running on sample data. Set API_SPORTS_KEY to serve live fixtures and a real tracker.',
      );
    }

    await app.listen({ port: config.port, host: config.host });
    app.log.info(
      `NexusBet AI engine listening on ${config.host}:${config.port} (provider: ${provider.name})`,
    );
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }

  return app;
}

if (require.main === module) {
  startServer();
}

module.exports = { buildServer, startServer };
