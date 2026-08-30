'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  PunterLounge,
  sanitiseText,
  MAX_MESSAGE_LENGTH,
  RATE_LIMIT_MAX_MESSAGES,
} = require('../src/lounge');
const { buildAccuracyHistory } = require('../src/data');

const silentLogger = { info() {}, warn() {}, error() {} };

/** Minimal stand-in for a ws socket: records what the server sends it. */
function fakeSocket() {
  const sent = [];
  return {
    readyState: 1,
    sent,
    listeners: {},
    send(payload) {
      sent.push(JSON.parse(payload));
    },
    on(event, handler) {
      this.listeners[event] = handler;
    },
    ping() {},
    terminate() {
      this.readyState = 3;
    },
    payloadsOfType(type) {
      return sent.filter((p) => p.type === type);
    },
  };
}

test('sanitiseText collapses whitespace and caps length', () => {
  assert.equal(sanitiseText('  hello   lounge  ', 100), 'hello lounge');
  assert.equal(sanitiseText('y'.repeat(900), MAX_MESSAGE_LENGTH).length, MAX_MESSAGE_LENGTH);
  assert.equal(sanitiseText(undefined, 10), '');
  assert.equal(sanitiseText({ evil: true }, 10), '');
});

test('joining replays history and publishes presence', () => {
  const lounge = new PunterLounge({ logger: silentLogger });
  const socket = fakeSocket();

  lounge.add(socket);

  const history = socket.payloadsOfType('history');
  assert.equal(history.length, 1);
  assert.ok(history[0].messages.length > 0);
  assert.deepEqual(socket.payloadsOfType('presence').at(-1), { type: 'presence', online: 1 });
});

test('a valid message fans out to every connected socket', () => {
  const lounge = new PunterLounge({ logger: silentLogger });
  const author = fakeSocket();
  const listener = fakeSocket();
  lounge.add(author);
  lounge.add(listener);

  const result = lounge.handleIncoming(
    author,
    JSON.stringify({ user: 'TesterB', msg: '  hello   lounge  ', tag: 'STK-ARS-77X' }),
  );

  assert.equal(result.msg, 'hello lounge');
  assert.equal(result.user, 'TesterB');
  assert.equal(result.tag, 'STK-ARS-77X');
  assert.equal(listener.payloadsOfType('message').length, 1);
  assert.deepEqual(listener.payloadsOfType('message')[0].message, result);
});

test('malformed and empty payloads are dropped without broadcasting', () => {
  const lounge = new PunterLounge({ logger: silentLogger });
  const socket = fakeSocket();
  lounge.add(socket);

  assert.equal(lounge.handleIncoming(socket, 'not json at all'), null);
  assert.equal(lounge.handleIncoming(socket, JSON.stringify({ msg: '   ' })), null);
  assert.equal(socket.payloadsOfType('message').length, 0);
});

test('a missing username falls back to AnonymousPunter', () => {
  const lounge = new PunterLounge({ logger: silentLogger });
  const socket = fakeSocket();
  lounge.add(socket);

  const result = lounge.handleIncoming(socket, JSON.stringify({ msg: 'no name here' }));
  assert.equal(result.user, 'AnonymousPunter');
});

test('a flooding socket is rate limited after the window budget', () => {
  const lounge = new PunterLounge({ logger: silentLogger });
  const socket = fakeSocket();
  lounge.add(socket);

  for (let i = 0; i < RATE_LIMIT_MAX_MESSAGES + 4; i += 1) {
    lounge.handleIncoming(socket, JSON.stringify({ user: 'Flooder', msg: `flood ${i}` }));
  }

  assert.equal(socket.payloadsOfType('message').length, RATE_LIMIT_MAX_MESSAGES);
  assert.equal(socket.payloadsOfType('error').length, 4);
  assert.equal(socket.payloadsOfType('error')[0].reason, 'rate_limited');
});

test('disconnecting decrements the presence count', () => {
  const lounge = new PunterLounge({ logger: silentLogger });
  const first = fakeSocket();
  const second = fakeSocket();
  lounge.add(first);
  lounge.add(second);
  assert.equal(lounge.size, 2);

  lounge.remove(second);
  assert.equal(lounge.size, 1);
  assert.deepEqual(first.payloadsOfType('presence').at(-1), { type: 'presence', online: 1 });
});

test('a socket that misses a ping is reaped on the next sweep', () => {
  const lounge = new PunterLounge({ logger: silentLogger });
  const socket = fakeSocket();
  lounge.add(socket);

  lounge.reapStaleSockets(); // marks the socket as awaiting a pong
  assert.equal(lounge.size, 1);
  lounge.reapStaleSockets(); // no pong arrived, so it is dropped
  assert.equal(lounge.size, 0);
});

test('tracker headline figures are derived from the audit rows', () => {
  const summary = buildAccuracyHistory([
    { id: 1, status: 'WIN' },
    { id: 2, status: 'WIN' },
    { id: 3, status: 'LOSS' },
    { id: 4, status: 'WIN' },
  ]);

  assert.equal(summary.overallWinRate, '75.0%');
  assert.equal(summary.currentStreak, '2 Wins Row');
  assert.equal(summary.totalBetsAnalyzed, 4);
  assert.equal(summary.sampleData, true);
});

test('an empty result set does not fabricate a win rate', () => {
  const summary = buildAccuracyHistory([]);
  assert.equal(summary.overallWinRate, '0.0%');
  assert.equal(summary.totalBetsAnalyzed, 0);
});
