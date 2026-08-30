'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createNotifier,
  createTelegramChannel,
  createWebhookChannel,
  createChannelsFromConfig,
  formatCard,
  buildPayload,
  escapeHtml,
} = require('../src/notify');

const silentLogger = { warn() {}, info() {}, debug() {}, error() {} };

const entry = (overrides = {}) => ({
  key: 'football:239625',
  sport: 'football',
  league: 'Premier League',
  match: 'Arsenal vs Chelsea',
  home: 'Arsenal',
  away: 'Chelsea',
  prediction: 'Arsenal to Win',
  pickLabel: 'Home',
  probability: 58.2,
  odd: 1.9,
  bookmaker: 'Bwin',
  status: 'WIN',
  settledAt: '2026-09-01T16:00:00Z',
  recordedAt: '2026-09-01T09:00:00Z',
  result: { homeScore: 2, awayScore: 1, status: 'FT' },
  notifiedAt: null,
  ...overrides,
});

const summary = { wins: 12, losses: 8, settledCount: 20, winRate: 60 };

/** Records every send, optionally failing. */
function stubChannel(name, { fail = false } = {}) {
  const sent = [];
  return {
    name,
    sent,
    async send(item, record) {
      if (fail) throw new Error(`${name} is down`);
      sent.push({ item, record });
      return { channel: name, ok: true };
    },
  };
}

test('escapeHtml neutralises Telegram markup characters', () => {
  assert.equal(escapeHtml('Chelsea & <b>co</b>'), 'Chelsea &amp; &lt;b&gt;co&lt;/b&gt;');
  assert.equal(escapeHtml(null), '');
});

test('the card carries the fixture, result and price', () => {
  const card = formatCard(entry(), summary);

  assert.match(card, /WIN/);
  assert.match(card, /Arsenal to Win/);
  assert.match(card, /Arsenal vs Chelsea/);
  assert.match(card, /Premier League/);
  assert.match(card, /2–1/);
  assert.match(card, /1\.9/);
});

test('the card always states the running settled record', () => {
  const card = formatCard(entry(), summary);
  // A feed of wins with no denominator reads as an unbroken run.
  assert.match(card, /12W–8L/);
  assert.match(card, /60%/);
});

test('a team name with markup characters cannot break the card', () => {
  const card = formatCard(entry({ match: 'Arsenal vs <script>alert(1)</script>' }), summary);
  assert.ok(!card.includes('<script>'), 'raw markup must not survive into the card');
  assert.match(card, /&lt;script&gt;/);
});

test('the card degrades gracefully with missing fields', () => {
  const card = formatCard(
    entry({ result: null, odd: null, probability: null, bookmaker: null, league: null }),
    null,
  );
  assert.match(card, /Arsenal to Win/);
  assert.ok(!card.includes('undefined'));
  assert.ok(!card.includes('null'));
});

test('a LOSS renders with its own marker', () => {
  assert.match(formatCard(entry({ status: 'LOSS' }), summary), /LOSS/);
});

test('the webhook payload is structured and complete', () => {
  const payload = buildPayload(entry(), summary);

  assert.equal(payload.event, 'prediction.settled');
  assert.equal(payload.status, 'WIN');
  assert.equal(payload.pick.match, 'Arsenal vs Chelsea');
  assert.equal(payload.pick.odd, 1.9);
  assert.equal(payload.result.homeScore, 2);
  assert.equal(payload.record.winRate, 60);
});

test('only the configured statuses notify', () => {
  const notifier = createNotifier({ channels: [stubChannel('a')], logger: silentLogger });

  assert.equal(notifier.shouldNotify(entry({ status: 'WIN' })), true);
  assert.equal(notifier.shouldNotify(entry({ status: 'LOSS' })), false);
  assert.equal(notifier.shouldNotify(entry({ status: 'VOID' })), false);
  assert.equal(notifier.shouldNotify(entry({ status: 'PENDING' })), false);
});

test('statuses are configurable for a complete feed', () => {
  const notifier = createNotifier({
    channels: [stubChannel('a')],
    statuses: ['WIN', 'LOSS'],
    logger: silentLogger,
  });

  assert.equal(notifier.shouldNotify(entry({ status: 'LOSS' })), true);
});

test('an already-notified pick is never sent again', () => {
  const notifier = createNotifier({ channels: [stubChannel('a')], logger: silentLogger });
  assert.equal(notifier.shouldNotify(entry({ notifiedAt: '2026-09-01T16:05:00Z' })), false);
});

test('a delivered notification marks the entry and fans out to every channel', async () => {
  const telegram = stubChannel('telegram');
  const webhook = stubChannel('webhook');
  const notifier = createNotifier({ channels: [telegram, webhook], logger: silentLogger });

  const item = entry();
  const result = await notifier.notifySettled([item], summary);

  assert.equal(result.sent, 1);
  assert.equal(result.failed, 0);
  assert.equal(telegram.sent.length, 1);
  assert.equal(webhook.sent.length, 1);
  assert.ok(item.notifiedAt, 'the entry must be marked delivered');
});

test('one failing channel does not lose the notification', async () => {
  const working = stubChannel('webhook');
  const broken = stubChannel('telegram', { fail: true });
  const notifier = createNotifier({ channels: [broken, working], logger: silentLogger });

  const item = entry();
  const result = await notifier.notifySettled([item], summary);

  assert.equal(result.sent, 1, 'one channel accepting is enough');
  assert.equal(working.sent.length, 1);
  assert.ok(item.notifiedAt);
});

test('a total outage leaves the pick queued for the next pass', async () => {
  const notifier = createNotifier({
    channels: [stubChannel('telegram', { fail: true })],
    logger: silentLogger,
  });

  const item = entry();
  const result = await notifier.notifySettled([item], summary);

  assert.equal(result.sent, 0);
  assert.equal(result.failed, 1);
  assert.equal(item.notifiedAt, null, 'an undelivered card must be retried later');
});

test('notifySettled never throws, whatever the channel does', async () => {
  const exploding = {
    name: 'bad',
    send() {
      throw new Error('synchronous explosion');
    },
  };
  const notifier = createNotifier({ channels: [exploding], logger: silentLogger });

  const result = await notifier.notifySettled([entry()], summary);
  assert.equal(result.failed, 1, 'settlement must not be taken down by a notifier');
});

test('a notifier with no channels is inert', async () => {
  const notifier = createNotifier({ channels: [], logger: silentLogger });

  assert.equal(notifier.enabled, false);
  const result = await notifier.notifySettled([entry()], summary);
  assert.equal(result.sent, 0);
  assert.equal(result.skipped, 1);
});

test('a batch is capped so one pass cannot flood a channel', async () => {
  const channel = stubChannel('telegram');
  const notifier = createNotifier({ channels: [channel], logger: silentLogger });

  const many = Array.from({ length: 50 }, (_, i) => entry({ key: `football:${i}` }));
  const result = await notifier.notifySettled(many, summary);

  assert.equal(result.sent, 20);
  assert.equal(channel.sent.length, 20);
});

test('the telegram channel treats ok:false as a failure', async () => {
  const channel = createTelegramChannel({
    botToken: 't',
    chatId: 'c',
    logger: silentLogger,
    // Telegram answers 200 with ok:false for a bad chat id.
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ ok: false, description: 'chat not found' }),
    }),
  });

  await assert.rejects(() => channel.send(entry(), summary), /chat not found/);
});

test('the telegram channel posts a formatted card to the right endpoint', async () => {
  const calls = [];
  const channel = createTelegramChannel({
    botToken: 'BOT123',
    chatId: '-100777',
    logger: silentLogger,
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ ok: true }) };
    },
  });

  await channel.send(entry(), summary);

  assert.match(calls[0].url, /\/botBOT123\/sendMessage$/);
  assert.equal(calls[0].body.chat_id, '-100777');
  assert.equal(calls[0].body.parse_mode, 'HTML');
  assert.match(calls[0].body.text, /Arsenal to Win/);
});

test('an incompletely configured channel refuses to construct', () => {
  assert.throws(() => createTelegramChannel({ botToken: 't', logger: silentLogger }), /chat id/);
  assert.throws(() => createWebhookChannel({ logger: silentLogger }), /URL/);
});

test('the webhook channel treats a non-2xx as a failure', async () => {
  const channel = createWebhookChannel({
    url: 'https://hooks.example/x',
    logger: silentLogger,
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });

  await assert.rejects(() => channel.send(entry(), summary), /500/);
});

test('channels are built only from complete configuration', () => {
  assert.equal(createChannelsFromConfig({}, { logger: silentLogger }).length, 0);
  assert.equal(
    createChannelsFromConfig({ telegram: { botToken: 't' } }, { logger: silentLogger }).length,
    0,
    'a half-configured channel is skipped, not constructed',
  );
  assert.equal(
    createChannelsFromConfig(
      { telegram: { botToken: 't', chatId: 'c' }, webhook: { url: 'https://x.test' } },
      { logger: silentLogger },
    ).length,
    2,
  );
});
