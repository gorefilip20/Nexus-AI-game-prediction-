'use strict';

const fastify = require('fastify')({ logger: true });

const { predictions, buildAccuracyHistory } = require('./data');
const { PunterLounge } = require('./lounge');

const PORT = Number(process.env.PORT ?? 5000);
const HOST = process.env.HOST ?? '0.0.0.0';
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? 'http://localhost:5173';

const lounge = new PunterLounge({ logger: fastify.log });

fastify.register(require('@fastify/cors'), { origin: CORS_ORIGIN });
fastify.register(require('@fastify/websocket'));

fastify.get('/api/health', async () => ({
  status: 'ok',
  online: lounge.size,
  uptime: process.uptime(),
}));

fastify.get('/api/predictions', async () => ({
  sampleData: true,
  predictions,
}));

fastify.get('/api/tracker', async () => buildAccuracyHistory());

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
    await fastify.listen({ port: PORT, host: HOST });
    fastify.log.info(`NexusBet AI engine listening on ${HOST}:${PORT}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

const shutdown = async (signal) => {
  fastify.log.info(`Received ${signal}, shutting down.`);
  lounge.stop();
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

module.exports = { fastify, lounge, startServer };
