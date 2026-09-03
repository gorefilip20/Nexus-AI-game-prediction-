'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  computePerformance,
  profitOf,
  isStaked,
  standardError,
  byConfidenceBand,
} = require('../src/performance');

const pick = (status, odd, probability = 60) => ({ status, odd, probability });

test('a winner returns the price less the stake', () => {
  assert.equal(profitOf(pick('WIN', 2.5)), 1.5);
  assert.equal(profitOf(pick('WIN', 1.2)), 0.2);
});

test('a loser costs the stake and a void costs nothing', () => {
  assert.equal(profitOf(pick('LOSS', 2.5)), -1);
  assert.equal(profitOf(pick('VOID', 2.5)), 0);
  assert.equal(profitOf(pick('PENDING', 2.5)), 0);
});

test('a win with no recorded price is not valued', () => {
  // Inventing a return here would quietly inflate the ROI.
  assert.equal(profitOf(pick('WIN', null)), 0);
  assert.equal(profitOf(pick('WIN', 1)), 0);
});

test('only graded picks count as staked', () => {
  assert.equal(isStaked(pick('WIN', 2)), true);
  assert.equal(isStaked(pick('LOSS', 2)), true);
  assert.equal(isStaked(pick('VOID', 2)), false);
  assert.equal(isStaked(pick('PENDING', 2)), false);
});

test('an empty ledger reports no ROI rather than zero', () => {
  const result = computePerformance([]);

  assert.equal(result.roi, null);
  assert.equal(result.profitUnits, null);
  assert.equal(result.staked, 0);
  assert.match(result.verdict, /no settled picks/);
});

test('pending picks alone still report no ROI', () => {
  const result = computePerformance([pick('PENDING', 2), pick('VOID', 2)]);
  assert.equal(result.roi, null);
});

test('ROI is computed from the real prices', () => {
  // Two winners at 2.0 (+1 each), two losers (−1 each) = break even.
  const result = computePerformance([
    pick('WIN', 2),
    pick('WIN', 2),
    pick('LOSS', 2),
    pick('LOSS', 2),
  ]);

  assert.equal(result.profitUnits, 0);
  assert.equal(result.roi, 0);
  assert.equal(result.strikeRate, 50);
  assert.equal(result.breakEvenStrikeRate, 50);
});

test('a high strike rate at short odds still loses money', () => {
  // The whole argument, as a test: 80% winners at 1.20 is a losing book.
  const picks = Array.from({ length: 200 }, (_, i) => pick(i % 5 === 0 ? 'LOSS' : 'WIN', 1.2, 82));
  const result = computePerformance(picks);

  assert.equal(result.strikeRate, 80);
  assert.equal(result.breakEvenStrikeRate, 83.3);
  assert.ok(result.roi < 0, `expected a loss, got ROI ${result.roi}%`);
});

test('a low strike rate at long odds can still profit', () => {
  // 30% winners at 5.0 returns +50% on stake.
  const picks = Array.from({ length: 200 }, (_, i) => pick(i % 10 < 3 ? 'WIN' : 'LOSS', 5, 30));
  const result = computePerformance(picks);

  assert.equal(result.strikeRate, 30);
  assert.ok(result.roi > 0, `expected a profit, got ROI ${result.roi}%`);
});

test('voids are excluded from the staked count', () => {
  const result = computePerformance([pick('WIN', 2), pick('VOID', 2), pick('LOSS', 2)]);
  assert.equal(result.staked, 2);
  assert.equal(result.profitUnits, 0);
});

test('a small sample is called noise, whatever the ROI', () => {
  const result = computePerformance([pick('WIN', 10), pick('LOSS', 10)]);

  assert.ok(result.roi > 0);
  assert.match(result.verdict, /too few settled picks/);
  assert.equal(result.significant, false, 'two picks can never be significant');
});

test('a result inside the margin of error is not claimed as an edge', () => {
  // 100 picks at even money, 52 winners: positive but well within noise.
  const picks = Array.from({ length: 100 }, (_, i) => pick(i < 52 ? 'WIN' : 'LOSS', 2));
  const result = computePerformance(picks);

  assert.ok(result.roi > 0);
  assert.equal(result.significant, false);
  assert.match(result.verdict, /inside the margin of error/);
});

test('a large, clearly losing sample is reported as losing', () => {
  const picks = Array.from({ length: 1000 }, (_, i) => pick(i % 4 === 0 ? 'WIN' : 'LOSS', 2));
  const result = computePerformance(picks);

  assert.ok(result.roi < 0);
  assert.equal(result.significant, true);
  assert.match(result.verdict, /losing over this sample/);
});

test('the reported range widens as the sample shrinks', () => {
  const many = computePerformance(Array.from({ length: 1000 }, () => pick('WIN', 2)).map((p, i) =>
    i % 2 ? pick('LOSS', 2) : p,
  ));
  const few = computePerformance(Array.from({ length: 20 }, (_, i) => pick(i % 2 ? 'LOSS' : 'WIN', 2)));

  const wide = few.roiRange.high - few.roiRange.low;
  const narrow = many.roiRange.high - many.roiRange.low;
  assert.ok(wide > narrow, 'a smaller sample must report a wider range');
});

test('standardError needs more than one observation', () => {
  assert.equal(standardError([1]), null);
  assert.equal(standardError([]), null);
  assert.ok(standardError([1, -1, 1, -1]) > 0);
});

test('confidence bands locate where an edge sits, if anywhere', () => {
  const bands = byConfidenceBand([
    ...Array.from({ length: 10 }, () => pick('WIN', 3, 85)),
    ...Array.from({ length: 10 }, () => pick('LOSS', 3, 55)),
  ]);

  const high = bands.find((b) => b.band === '80%+');
  const low = bands.find((b) => b.band === '50–60%');

  assert.equal(high.strikeRate, 100);
  assert.ok(high.roi > 0);
  assert.equal(low.strikeRate, 0);
  assert.ok(low.roi < 0);
});
