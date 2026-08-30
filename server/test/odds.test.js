'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { impliedProbability, overround, devig, favourite } = require('../src/odds');

test('decimal odds convert to implied probability', () => {
  assert.equal(impliedProbability(2), 0.5);
  assert.equal(impliedProbability('4.00'), 0.25);
});

test('unusable odds yield null rather than a misleading number', () => {
  assert.equal(impliedProbability(1), null);
  assert.equal(impliedProbability(0), null);
  assert.equal(impliedProbability(-3), null);
  assert.equal(impliedProbability('not a price'), null);
  assert.equal(impliedProbability(null), null);
});

test('overround exposes the bookmaker margin', () => {
  // A fair coin priced at 1.90/1.90 carries roughly a 5.3% margin.
  const margin = overround([1.9, 1.9]);
  assert.ok(margin > 1.05 && margin < 1.06, `unexpected overround ${margin}`);
  assert.equal(overround([2, 2]), 1);
});

test('devig normalises probabilities to sum to one', () => {
  const fair = devig([1.9, 3.6, 4.2]);
  const total = fair.reduce((sum, p) => sum + p, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `probabilities summed to ${total}`);
  assert.ok(fair[0] > fair[1] && fair[1] > fair[2]);
});

test('devig refuses a market with an unusable leg', () => {
  assert.equal(devig([1.9, 'suspended', 4.2]), null);
  assert.equal(devig([]), null);
});

test('favourite picks the shortest price and reports a devigged probability', () => {
  const pick = favourite([
    { label: 'Home', odd: '1.90' },
    { label: 'Draw', odd: '3.60' },
    { label: 'Away', odd: '4.20' },
  ]);

  assert.equal(pick.label, 'Home');
  assert.equal(pick.odd, 1.9);
  // Raw implied is 52.6%; stripping the margin lowers it, and it must stay below
  // the raw figure or the app would overstate the market's confidence.
  assert.ok(pick.probability < 1 / 1.9);
  assert.ok(pick.probability > 0.47 && pick.probability < 0.52);
  assert.ok(pick.overround > 1);
});

test('favourite returns null for a market it cannot price', () => {
  assert.equal(favourite([{ label: 'Home', odd: '1.90' }]), null);
  assert.equal(favourite([{ label: 'Home', odd: '1.90' }, { label: 'Away', odd: '0' }]), null);
  assert.equal(favourite(null), null);
});
