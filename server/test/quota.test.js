'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { QuotaManager, startOfUtcDay, parseHeaderInt } = require('../src/quota');
const { createEgress, describeProxy, validateProxyUrl } = require('../src/egress');
const { parseRetryAfter } = require('../src/http');

const silentLogger = { warn() {}, info() {}, error() {} };

/** Response headers as the provider sends them. */
const headers = (remaining, limit = 100) => ({
  get: (name) => {
    if (name === 'x-ratelimit-requests-remaining') return remaining === null ? null : String(remaining);
    if (name === 'x-ratelimit-requests-limit') return String(limit);
    return null;
  },
});

function managerAt(isoTime, options = {}) {
  const clock = { now: new Date(isoTime) };
  const manager = new QuotaManager({
    dailyLimit: 100,
    logger: silentLogger,
    now: () => clock.now,
    ...options,
  });
  return { manager, clock };
}

test('parseHeaderInt tolerates missing and malformed headers', () => {
  assert.equal(parseHeaderInt(headers(42), 'x-ratelimit-requests-remaining'), 42);
  assert.equal(parseHeaderInt(headers(null), 'x-ratelimit-requests-remaining'), null);
  assert.equal(parseHeaderInt(undefined, 'anything'), null);
  assert.equal(parseHeaderInt({ get: () => 'abc' }, 'x'), null);
});

test('startOfUtcDay ignores local time', () => {
  const a = startOfUtcDay(new Date('2026-09-01T23:59:59Z'));
  const b = startOfUtcDay(new Date('2026-09-01T00:00:00Z'));
  assert.equal(a, b);
});

test("the provider's own remaining count is authoritative", () => {
  const { manager } = managerAt('2026-09-01T12:00:00Z');
  manager.observeHeaders('football', headers(37));
  assert.equal(manager.remainingFor('football'), 37);
});

test('without headers the manager falls back to counting its own spend', () => {
  const { manager } = managerAt('2026-09-01T12:00:00Z');
  manager.observeHeaders('football', headers(null));
  manager.observeHeaders('football', headers(null));
  assert.equal(manager.remainingFor('football'), 98);
});

test('a reported limit replaces the configured default', () => {
  const { manager } = managerAt('2026-09-01T12:00:00Z');
  manager.observeHeaders('football', headers(7400, 7500));
  assert.equal(manager.snapshot('football').limit, 7500);
});

test('the budget resets when the UTC day rolls over', () => {
  const { manager, clock } = managerAt('2026-09-01T23:00:00Z');
  manager.observeHeaders('football', headers(2));
  assert.equal(manager.canSpend('football', 'normal').allowed, false);

  clock.now = new Date('2026-09-02T00:30:00Z');
  assert.equal(manager.remainingFor('football'), 100, 'a new day restores the allowance');
  assert.equal(manager.canSpend('football', 'normal').allowed, true);
});

test('pacing tracks the fraction of the day elapsed', () => {
  const { manager, clock } = managerAt('2026-09-01T06:00:00Z');
  assert.equal(manager.pacedAllowance('football'), 25);

  clock.now = new Date('2026-09-01T18:00:00Z');
  assert.equal(manager.pacedAllowance('football'), 75);
});

test('spending ahead of pace defers normal work but not high priority', () => {
  // 06:00 allows 25 of 100; 60 already spent is well ahead.
  const { manager } = managerAt('2026-09-01T06:00:00Z');
  manager.observeHeaders('football', headers(40));

  assert.equal(manager.canSpend('football', 'normal').allowed, false);
  assert.match(manager.canSpend('football', 'normal').reason, /ahead of the daily pace/);
  assert.equal(manager.canSpend('football', 'high').allowed, true);
  assert.equal(manager.canSpend('football', 'critical').allowed, true);
});

test('each tier stops at its own reserve floor', () => {
  const { manager } = managerAt('2026-09-01T23:00:00Z');
  manager.observeHeaders('football', headers(10));

  assert.equal(manager.canSpend('football', 'low').allowed, false);
  assert.equal(manager.canSpend('football', 'normal').allowed, false);
  assert.equal(manager.canSpend('football', 'high').allowed, true);
  assert.equal(manager.canSpend('football', 'critical').allowed, true);
});

test('settlement still runs on the last request of the day', () => {
  const { manager } = managerAt('2026-09-01T23:59:00Z');
  manager.observeHeaders('football', headers(1));

  assert.equal(manager.canSpend('football', 'critical').allowed, true);
  assert.equal(manager.canSpend('football', 'high').allowed, false);
});

test('an exhausted quota refuses every tier', () => {
  const { manager } = managerAt('2026-09-01T20:00:00Z');
  manager.observeHeaders('football', headers(0));

  for (const tier of ['critical', 'high', 'normal', 'low']) {
    const verdict = manager.canSpend('football', tier);
    assert.equal(verdict.allowed, false, `${tier} must not spend past the limit`);
    assert.match(verdict.reason, /exhausted/);
  }
});

test('a 429 pauses that sport for at least a minute', () => {
  const { manager, clock } = managerAt('2026-09-01T12:00:00Z');
  manager.observeHeaders('football', headers(50));
  manager.observeRateLimited('football', 30);

  const verdict = manager.canSpend('football', 'critical');
  assert.equal(verdict.allowed, false);
  assert.match(verdict.reason, /rate limited/);

  clock.now = new Date('2026-09-01T12:01:30Z');
  assert.equal(manager.canSpend('football', 'critical').allowed, true);
});

test('a long Retry-After is honoured in full', () => {
  const { manager, clock } = managerAt('2026-09-01T12:00:00Z');
  manager.observeHeaders('football', headers(50));
  manager.observeRateLimited('football', 600);

  clock.now = new Date('2026-09-01T12:05:00Z');
  assert.equal(manager.canSpend('football', 'high').allowed, false, 'still inside the window');

  clock.now = new Date('2026-09-01T12:10:01Z');
  assert.equal(manager.canSpend('football', 'high').allowed, true);
});

test('a rate limit on one sport does not pause the others', () => {
  const { manager } = managerAt('2026-09-01T12:00:00Z');
  manager.observeHeaders('football', headers(50));
  manager.observeHeaders('basketball', headers(50));
  manager.observeRateLimited('football', 120);

  assert.equal(manager.canSpend('football', 'high').allowed, false);
  assert.equal(manager.canSpend('basketball', 'high').allowed, true);
});

test('an unknown priority is treated as normal rather than waved through', () => {
  const { manager } = managerAt('2026-09-01T23:00:00Z');
  manager.observeHeaders('football', headers(10));
  assert.equal(manager.canSpend('football', 'made-up-tier').allowed, false);
});

test('snapshotAll reports every sport seen', () => {
  const { manager } = managerAt('2026-09-01T12:00:00Z');
  manager.observeHeaders('football', headers(50));
  manager.observeHeaders('volleyball', headers(80));

  const all = manager.snapshotAll();
  assert.deepEqual(Object.keys(all).sort(), ['football', 'volleyball']);
  assert.equal(all.volleyball.remaining, 80);
});

test('parseRetryAfter accepts both seconds and an HTTP date', () => {
  assert.equal(parseRetryAfter({ get: () => '120' }), 120);
  assert.equal(parseRetryAfter({ get: () => null }), null);
  assert.equal(parseRetryAfter({ get: () => 'not a date' }), null);

  const future = new Date(Date.now() + 60_000).toUTCString();
  const seconds = parseRetryAfter({ get: () => future });
  assert.ok(seconds >= 55 && seconds <= 61, `expected about 60s, got ${seconds}`);
});

test('egress defaults to a direct keep-alive agent', () => {
  const egress = createEgress({ logger: silentLogger });
  assert.equal(egress.viaProxy, false);
  assert.ok(egress.dispatcher, 'connection reuse still needs a dispatcher');
});

test('a configured proxy is used and its credentials are never exposed', () => {
  const egress = createEgress({
    proxyUrl: 'http://user:sup3rs3cret@egress.example.com:8080',
    logger: silentLogger,
  });

  assert.equal(egress.viaProxy, true);
  assert.ok(!egress.description.includes('sup3rs3cret'), 'the password must be redacted');
  assert.match(egress.description, /egress\.example\.com:8080/);
});

test('an unusable proxy URL fails loudly at construction', () => {
  assert.throws(() => createEgress({ proxyUrl: 'socks5://host:1080', logger: silentLogger }), /http:/);
  assert.throws(() => createEgress({ proxyUrl: 'nonsense', logger: silentLogger }), /not a valid URL/);
});

test('describeProxy handles a credential-free URL', () => {
  assert.equal(describeProxy('http://proxy.internal:3128'), 'http://proxy.internal:3128');
  assert.equal(validateProxyUrl('https://proxy.internal:3128').protocol, 'https:');
});

test('a 429 fails fast instead of sleeping out the Retry-After window', async () => {
  const { getJson, ProviderError } = require('../src/http');

  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    return {
      ok: false,
      status: 429,
      json: async () => ({}),
      // An hour-long cooldown: retrying inline would pin the handler open.
      headers: { get: (name) => (name === 'retry-after' ? '3600' : null) },
    };
  };

  const started = Date.now();
  let reported = null;

  await assert.rejects(
    () =>
      getJson('https://example.test/x', {
        fetchImpl,
        retries: 2,
        logger: silentLogger,
        onRateLimited: (seconds) => {
          reported = seconds;
        },
      }),
    (err) => err instanceof ProviderError && err.status === 429,
  );

  assert.equal(attempts, 1, 'a 429 must not be retried inline');
  assert.equal(reported, 3600, 'the cooldown is reported to the scheduler');
  assert.ok(Date.now() - started < 1000, 'the call must return immediately');
});

test('transient 5xx errors are still retried, with a bounded wait', async () => {
  const { getJson } = require('../src/http');

  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts < 3) {
      return { ok: false, status: 503, json: async () => ({}), headers: { get: () => null } };
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({ response: [] }),
      headers: { get: () => null },
    };
  };

  const started = Date.now();
  const { body } = await getJson('https://example.test/x', {
    fetchImpl,
    retries: 3,
    logger: silentLogger,
  });

  assert.deepEqual(body, { response: [] });
  assert.equal(attempts, 3);
  assert.ok(Date.now() - started < 5000, 'backoff stays bounded');
});
