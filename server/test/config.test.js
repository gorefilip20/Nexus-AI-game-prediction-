'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { validateConfig, assertValidConfig, intFromEnv, boolFromEnv } = require('../src/config');

const silentLogger = { warn() {}, error() {}, info() {} };

/** A configuration that passes production validation, for tests to vary. */
const productionConfig = (overrides = {}) => ({
  isProduction: true,
  port: 5000,
  corsOrigin: ['https://nexusbet.example'],
  trustProxy: true,
  ledgerPath: '/data/ledger.json',
  provider: 'api-sports',
  apiSports: { key: 'a-real-key', mode: 'direct' },
  ...overrides,
});

test('intFromEnv rejects non-positive and malformed values', () => {
  process.env.TEST_INT = '42';
  assert.equal(intFromEnv('TEST_INT', 7), 42);
  process.env.TEST_INT = '0';
  assert.equal(intFromEnv('TEST_INT', 7), 7);
  process.env.TEST_INT = '-3';
  assert.equal(intFromEnv('TEST_INT', 7), 7);
  process.env.TEST_INT = 'banana';
  assert.equal(intFromEnv('TEST_INT', 7), 7);
  delete process.env.TEST_INT;
  assert.equal(intFromEnv('TEST_INT', 7), 7);
});

test('boolFromEnv accepts the usual truthy spellings', () => {
  for (const value of ['true', 'TRUE', '1', 'yes']) {
    process.env.TEST_BOOL = value;
    assert.equal(boolFromEnv('TEST_BOOL', false), true, `${value} should be true`);
  }
  for (const value of ['false', '0', 'no', 'anything']) {
    process.env.TEST_BOOL = value;
    assert.equal(boolFromEnv('TEST_BOOL', true), false, `${value} should be false`);
  }
  process.env.TEST_BOOL = '';
  assert.equal(boolFromEnv('TEST_BOOL', true), true, 'empty falls back');
  delete process.env.TEST_BOOL;
});

test('a well-formed production config validates', () => {
  const result = validateConfig(productionConfig());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.warnings, []);
});

test('a wildcard CORS origin is fatal in production', () => {
  const result = validateConfig(productionConfig({ corsOrigin: '*' }));
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /CORS_ORIGIN/.test(e)));
});

test('a wildcard CORS origin is allowed outside production', () => {
  const result = validateConfig(productionConfig({ isProduction: false, corsOrigin: '*' }));
  assert.equal(result.ok, true);
});

test('falling back to sample data in production is fatal', () => {
  delete process.env.SPORTS_PROVIDER;
  const result = validateConfig(productionConfig({ provider: 'sample' }));

  assert.equal(result.ok, false);
  assert.ok(
    result.errors.some((e) => /sample data in production/.test(e)),
    'serving demo fixtures as live data must not be accidental',
  );
});

test('sample data in production is allowed when stated explicitly', () => {
  process.env.SPORTS_PROVIDER = 'sample';
  const result = validateConfig(productionConfig({ provider: 'sample' }));
  assert.equal(result.ok, true);
  delete process.env.SPORTS_PROVIDER;
});

test('api-sports without a key is fatal', () => {
  const result = validateConfig(
    productionConfig({ apiSports: { key: '', mode: 'direct' } }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /API_SPORTS_KEY/.test(e)));
});

test('an unknown provider mode is rejected', () => {
  const result = validateConfig(
    productionConfig({ apiSports: { key: 'k', mode: 'sideways' } }),
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /API_SPORTS_MODE/.test(e)));
});

test('an out-of-range port is rejected in any environment', () => {
  assert.equal(validateConfig(productionConfig({ port: 0 })).ok, false);
  assert.equal(validateConfig(productionConfig({ port: 70000 })).ok, false);
  assert.equal(
    validateConfig(productionConfig({ isProduction: false, port: 99999 })).ok,
    false,
  );
});

test('an ephemeral ledger path warns without blocking the boot', () => {
  const result = validateConfig(productionConfig({ ledgerPath: null }));
  assert.equal(result.ok, true, 'this is advisory, not fatal');
  assert.ok(result.warnings.some((w) => /LEDGER_PATH/.test(w)));
});

test('running behind a proxy without TRUST_PROXY warns', () => {
  const result = validateConfig(productionConfig({ trustProxy: false }));
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((w) => /TRUST_PROXY/.test(w)));
});

test('a secret exposed through a VITE_ prefix is fatal', () => {
  process.env.VITE_API_SPORTS_KEY = 'leaked-into-the-bundle';
  const result = validateConfig(productionConfig());

  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => /VITE_API_SPORTS_KEY/.test(e)));
  delete process.env.VITE_API_SPORTS_KEY;
});

test('a VITE_ secret is caught outside production too', () => {
  // Deliberately matches the placeholder shape the secret scanner ignores, so
  // this fixture cannot be mistaken for a real credential.
  process.env.VITE_DATABASE_URL = 'postgres://user:password@db.example.com:5432/example';
  const result = validateConfig(productionConfig({ isProduction: false }));

  assert.equal(result.ok, false, 'a bundle leak is not environment-specific');
  delete process.env.VITE_DATABASE_URL;
});

test('a non-secret VITE_ variable is left alone', () => {
  process.env.VITE_API_TARGET = 'https://api.nexusbet.example';
  const result = validateConfig(productionConfig());

  assert.equal(result.ok, true, 'public URLs legitimately belong in the bundle');
  delete process.env.VITE_API_TARGET;
});

test('assertValidConfig throws on a fatal problem and lists every cause', () => {
  assert.throws(
    () => assertValidConfig(productionConfig({ corsOrigin: '*', port: 0 }), silentLogger),
    (err) => /CORS_ORIGIN/.test(err.message) && /PORT/.test(err.message),
  );
});

test('assertValidConfig passes a valid config and reports its warnings', () => {
  const logged = [];
  const result = assertValidConfig(productionConfig({ trustProxy: false }), {
    warn: (m) => logged.push(m),
  });

  assert.equal(result.errors.length, 0);
  assert.equal(result.warnings.length, 1);
  assert.ok(logged[0].includes('TRUST_PROXY'));
});
