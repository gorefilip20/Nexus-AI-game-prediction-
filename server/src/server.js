'use strict';

const fastify = require('fastify')({ logger: true });

const { config } = require('./config');
const { sampleTrackerSummary } = require('./data');
const { createProvider } = require('./providers');
const { buildBoard } = require('./board');
const { searchFixtures } = require('./search');
const { PredictionLedger, DEFAULT_PATH } = require('./ledger');
const { PunterLounge } = require('./lounge');

const lounge = new PunterLounge({ logger: fastify.log });
const provider = createProvider({ logger: fastify.log });
const ledger = new PredictionLedger({
  filePath: config.ledgerPath ?? DEFAULT_PATH,
  logger: fastify.log,
});

let settlementTimer = null;

fastify.register(require('@fastify/cors'), { origin: config.corsOrigin });
fastify.register(require('@fastify/websocket'));

/**
 * Loads the board and, for a live provider, writes every priced pick into the
 * ledger. Recording on read keeps the tracker honest without a separate
 * scheduler: a pick is only ever graded if it was actually shown.
 */
async function loadBoard() {
  const board = await buildBoard({
    provider,
    logger: fastify.log,
    modelEnabled: config.modelEnabled,
  });

  if (provider.live) {
    await ledger.load();
    if (ledger.record(board.slips) > 0) await ledger.save();
  }

  return board;
}

fastify.get('/api/health', async () => ({
  status: 'ok',
  online: lounge.size,
  provider: provider.name,
  live: provider.live,
  uptime: process.uptime(),
}));

fastify.get('/api/meta', async () => ({
  provider: provider.name,
  live: provider.live,
  sports: provider.sports,
  quota: provider.getQuota(),
  modelEnabled: config.modelEnabled,
  settlementIntervalMs: config.settlementIntervalMs,
}));

fastify.get('/api/predictions', async (request, reply) => {
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
      quota: board.quota,
      predictions: board.slips,
    };
  } catch (err) {
    fastify.log.error({ err }, 'Failed to load prediction board');
    return reply.code(502).send({
      error: 'provider_unavailable',
      message: err.message,
      provider: provider.name,
    });
  }
});

fastify.get('/api/search', async (request, reply) => {
  const { q, sport, days, limit } = request.query ?? {};

  try {
    return await searchFixtures({
      provider,
      query: q,
      sport: sport || null,
      days: days ?? 2,
      limit: limit ?? 12,
      logger: fastify.log,
      modelEnabled: config.modelEnabled,
    });
  } catch (err) {
    fastify.log.error({ err }, 'Search failed');
    return reply.code(502).send({ error: 'search_failed', message: err.message });
  }
});

fastify.get('/api/tracker', async (request, reply) => {
  if (!provider.live) return sampleTrackerSummary();

  try {
    await ledger.load();
    return ledger.summary();
  } catch (err) {
    fastify.log.error({ err }, 'Failed to read the prediction ledger');
    return reply.code(500).send({ error: 'ledger_unavailable', message: err.message });
  }
});

/** Grades every pending pick whose fixture has finished. */
async function runSettlement() {
  if (!provider.live) return { settled: 0 };

  await ledger.load();
  const pending = ledger.pendingReferences();
  if (pending.length === 0) return { settled: 0 };

  const results = await provider.getResults(pending);
  const settled = ledger.settle(results);
  if (settled > 0) {
    await ledger.save();
    fastify.log.info(`Settled ${settled} prediction(s).`);
  }

  return { settled };
}

fastify.post('/api/settle', async (request, reply) => {
  try {
    return await runSettlement();
  } catch (err) {
    fastify.log.error({ err }, 'Settlement pass failed');
    return reply.code(502).send({ error: 'settlement_failed', message: err.message });
  }
});

fastify.register(async function loungeRoutes(instance) {
  instance.get('/ws/punter-lounge', { websocket: true }, (connection) => {
    // @fastify/websocket v11 hands the raw socket to the handler; older releases
    // wrapped it as `connection.socket`. Support both so the route is portable.
    const socket = connection.socket ?? connection;

    lounge.add(socket);

    socket.on('message', (messageBuffer) => {
      try {
        lounge.handleIncoming(socket, messageBuffer);
      } catch (err) {
        fastify.log.error({ err }, 'Failed to process lounge message');
      }
    });

    socket.on('error', (err) => {
      fastify.log.error({ err }, 'Lounge socket error');
    });

    socket.on('close', () => lounge.remove(socket));
  });
});

const startServer = async () => {
  try {
    lounge.start();

    if (provider.live) {
      settlementTimer = setInterval(() => {
        runSettlement().catch((err) =>
          fastify.log.error({ err }, 'Scheduled settlement failed'),
        );
      }, config.settlementIntervalMs);
      settlementTimer.unref?.();
    } else {
      fastify.log.warn(
        'Running on sample data. Set API_SPORTS_KEY to serve live fixtures and a real tracker.',
      );
    }

    await fastify.listen({ port: config.port, host: config.host });
    fastify.log.info(
      `NexusBet AI engine listening on ${config.host}:${config.port} (provider: ${provider.name})`,
    );
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async (signal) => {
  fastify.log.info(`Received ${signal}, shutting down.`);
  lounge.stop();
  if (settlementTimer) clearInterval(settlementTimer);
  await fastify.close();
  process.exit(0);
};

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    shutdown(signal).catch(() => process.exit(1));
  });
}

if (require.main === module) {
  startServer();
}

module.exports = { fastify, lounge, provider, ledger, startServer, runSettlement };
