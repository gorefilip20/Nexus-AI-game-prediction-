'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildInsight,
  computeTeamForm,
  computeHeadToHead,
  computeValueGaps,
  resultFor,
} = require('../src/insight');
const { searchFixtures, fixtureMatches, matchesQuery, dateStrings } = require('../src/search');

const finished = (home, away, homeScore, awayScore, kickoff, sport = 'football') => ({
  sport,
  id: `${home}-${away}-${kickoff}`,
  leagueId: 39,
  league: 'Premier League',
  season: 2026,
  home,
  away,
  homeScore,
  awayScore,
  kickoff,
  timestamp: new Date(kickoff).getTime() / 1000,
  status: { short: 'FT', long: 'Match Finished', finished: true, notStarted: false },
});

const upcoming = (overrides = {}) => ({
  sport: 'football',
  id: 900001,
  leagueId: 39,
  league: 'Premier League',
  season: 2026,
  home: 'Chelsea',
  away: 'Brighton',
  kickoff: '2026-09-05T14:00:00Z',
  timestamp: 1788876000,
  homeScore: null,
  awayScore: null,
  status: { short: 'NS', long: 'Not Started', finished: false, notStarted: true },
  oddsAvailable: true,
  pickLabel: 'Home',
  probability: 50.5,
  odd: 1.9,
  marketOutcomes: [
    { label: 'Home', odd: 1.9, impliedProbability: 50.5 },
    { label: 'Draw', odd: 3.6, impliedProbability: 26.6 },
    { label: 'Away', odd: 4.2, impliedProbability: 22.9 },
  ],
  ...overrides,
});

const model = (overrides = {}) => ({
  model: 'poisson',
  reliable: true,
  trainedOn: 160,
  outcome: { home: 58.2, draw: 22.9, away: 19 },
  totals: [],
  handicaps: [],
  btts: { yes: 60, no: 40 },
  scorelines: [],
  expected: { home: 2.14, away: 1.14, unit: 'goals' },
  ...overrides,
});

const history = [
  finished('Chelsea', 'Everton', 3, 0, '2026-08-01T14:00:00Z'),
  finished('Fulham', 'Chelsea', 1, 2, '2026-08-08T14:00:00Z'),
  finished('Chelsea', 'Brighton', 2, 1, '2026-08-15T14:00:00Z'),
  finished('Brighton', 'Chelsea', 0, 1, '2026-08-22T14:00:00Z'),
  finished('Brighton', 'Everton', 1, 1, '2026-08-25T14:00:00Z'),
  finished('Fulham', 'Brighton', 2, 0, '2026-08-28T14:00:00Z'),
];

test('resultFor reads a fixture from each side', () => {
  const fixture = finished('Chelsea', 'Everton', 3, 0, '2026-08-01T14:00:00Z');

  const home = resultFor(fixture, 'Chelsea');
  assert.equal(home.outcome, 'W');
  assert.equal(home.scored, 3);
  assert.equal(home.isHome, true);

  const away = resultFor(fixture, 'Everton');
  assert.equal(away.outcome, 'L');
  assert.equal(away.scored, 0);
  assert.equal(away.opponent, 'Chelsea');
});

test('an unscored fixture yields no result', () => {
  assert.equal(resultFor(finished('A', 'B', null, null, '2026-08-01T00:00:00Z'), 'A'), null);
});

test('team form summarises the recent record, most recent first', () => {
  const form = computeTeamForm(history, 'Chelsea');

  assert.equal(form.played, 4);
  assert.equal(form.won, 4);
  assert.equal(form.lost, 0);
  assert.equal(form.formString, 'W W W W');
  assert.equal(form.streak.outcome, 'W');
  assert.equal(form.streak.length, 4);
  assert.equal(form.pointsPerGame, 3);
  assert.equal(form.winRate, 100);
  assert.equal(form.unit, 'goals');
});

test('form counts goals for and against per game', () => {
  const form = computeTeamForm(history, 'Brighton');
  assert.equal(form.played, 4);
  // Scored 1 + 0 + 1 + 0 = 2 across four matches.
  assert.equal(form.scoredPerGame, 0.5);
  assert.equal(form.drawn, 1);
});

test('form respects the match limit and returns null for an unseen team', () => {
  assert.equal(computeTeamForm(history, 'Chelsea', { limit: 2 }).played, 2);
  assert.equal(computeTeamForm(history, 'Nobody FC'), null);
  assert.equal(computeTeamForm([], 'Chelsea'), null);
});

test('form uses win-based points for sports without a draw', () => {
  const games = [
    finished('Lakers', 'Celtics', 110, 100, '2026-08-01T00:00:00Z', 'basketball'),
    finished('Celtics', 'Lakers', 99, 101, '2026-08-03T00:00:00Z', 'basketball'),
  ];
  const form = computeTeamForm(games, 'Lakers', { sport: 'basketball' });
  assert.equal(form.pointsPerGame, 1);
  assert.equal(form.unit, 'points');
});

test('head-to-head is oriented to the upcoming home side', () => {
  const h2h = computeHeadToHead(history, 'Chelsea', 'Brighton');

  assert.equal(h2h.meetings, 2);
  assert.equal(h2h.homeWins, 2, 'Chelsea won both meetings');
  assert.equal(h2h.awayWins, 0);
  assert.equal(h2h.averageCombined, 2);
  assert.equal(h2h.lastMeeting.home, 'Brighton');
});

test('head-to-head flips correctly when the sides swap', () => {
  const h2h = computeHeadToHead(history, 'Brighton', 'Chelsea');
  assert.equal(h2h.homeWins, 0);
  assert.equal(h2h.awayWins, 2);
});

test('head-to-head is null for teams that never met', () => {
  assert.equal(computeHeadToHead(history, 'Chelsea', 'Nobody FC'), null);
});

test('expected value is computed per outcome at the offered price', () => {
  const value = computeValueGaps(model(), upcoming().marketOutcomes);

  const home = value.outcomes.find((o) => o.label === 'Home');
  // 0.582 * 1.90 - 1 = +10.6%
  assert.equal(home.expectedValue, 10.6);
  assert.equal(home.gap, 7.7);
  assert.equal(home.modelProbability, 58.2);
  assert.equal(value.best.label, 'Home');
});

test('a model that agrees with the market shows a negative EV after the margin', () => {
  const agreeing = model({ outcome: { home: 50.5, draw: 26.6, away: 22.9 } });
  const value = computeValueGaps(agreeing, upcoming().marketOutcomes);

  assert.equal(value.outcomes.find((o) => o.label === 'Home').gap, 0);
  // Devigged agreement means the priced bet loses the bookmaker's margin.
  assert.ok(value.best.expectedValue < 0, 'agreeing with the market cannot be +EV');
});

test('value gaps need both a model and a market', () => {
  assert.equal(computeValueGaps(null, upcoming().marketOutcomes), null);
  assert.equal(computeValueGaps(model(), []), null);
  assert.equal(computeValueGaps(model(), [{ label: 'Home', odd: 1, impliedProbability: 100 }]), null);
});

test('the insight bundles form, head-to-head and value into bullets', () => {
  const insight = buildInsight({
    fixture: upcoming(),
    model: model(),
    slip: upcoming(),
    history,
    sport: 'football',
  });

  const categories = insight.bullets.map((b) => b.category);
  assert.ok(categories.includes('Model'));
  assert.ok(categories.includes('Team form'));
  assert.ok(categories.includes('Head-to-head'));
  assert.ok(categories.includes('Expected value'));
  assert.equal(insight.generator, 'rule-based-v1');
});

test('the justification string carries every bullet and caveat', () => {
  const insight = buildInsight({
    fixture: upcoming(),
    model: model(),
    slip: upcoming(),
    history,
  });

  assert.match(insight.matchJustification, /Chelsea vs Brighton/);
  assert.match(insight.matchJustification, /Model:/);
  assert.match(insight.matchJustification, /Team form:/);
  assert.match(insight.matchJustification, /Head-to-head:/);
  assert.match(insight.matchJustification, /Expected value:/);
  for (const bullet of insight.bullets) {
    assert.ok(insight.matchJustification.includes(bullet.text));
  }
});

test('generated text reports the real numbers, not placeholders', () => {
  const insight = buildInsight({
    fixture: upcoming(),
    model: model(),
    slip: upcoming(),
    history,
  });

  const formText = insight.bullets.find((b) => b.text.startsWith('Chelsea')).text;
  assert.match(formText, /last 4/);
  assert.match(formText, /W W W W/);

  const valueText = insight.bullets.find((b) => b.category === 'Expected value').text;
  assert.match(valueText, /58\.2%/);
  assert.match(valueText, /\+10\.6%/);
});

test('a thin model fit is called out as provisional', () => {
  const insight = buildInsight({
    fixture: upcoming(),
    model: model({ reliable: false, trainedOn: 9 }),
    slip: upcoming(),
    history,
  });

  assert.ok(insight.caveats.some((c) => /thin sample/.test(c)));
  assert.ok(insight.caveats.some((c) => /9 matches/.test(c)));
});

test('the market-is-better-calibrated caveat always accompanies a value claim', () => {
  const insight = buildInsight({
    fixture: upcoming(),
    model: model(),
    slip: upcoming(),
    history,
  });
  assert.ok(insight.caveats.some((c) => /better calibrated/.test(c)));
});

test('an unpriced fixture says so instead of implying value', () => {
  const slip = upcoming({ oddsAvailable: false, marketOutcomes: [] });
  const insight = buildInsight({ fixture: slip, model: model(), slip, history });

  const valueText = insight.bullets.find((b) => b.category === 'Expected value').text;
  assert.match(valueText, /No bookmaker market available/);
  assert.ok(insight.caveats.some((c) => /No priced market/.test(c)));
});

test('an insight with no model or history still generates without throwing', () => {
  const insight = buildInsight({ fixture: upcoming(), model: null, slip: null, history: [] });

  assert.equal(insight.bullets.length, 5);
  assert.ok(insight.caveats.some((c) => /No model could be fitted/.test(c)));
  assert.match(insight.matchJustification, /no finished fixtures in this dataset/i);
});

test('unfinished fixtures are excluded from form and head-to-head', () => {
  const withPending = [...history, { ...upcoming(), status: { finished: false } }];
  const insight = buildInsight({ fixture: upcoming(), model: model(), slip: upcoming(), history: withPending });
  assert.equal(insight.form.home.played, 4, 'the pending fixture must not count as form');
});

test('matchesQuery handles partial and punctuated names', () => {
  assert.ok(matchesQuery('Brighton & Hove Albion', 'brighton'));
  assert.ok(matchesQuery('LA Lakers', 'lakers'));
  assert.ok(matchesQuery('Chelsea', 'Chelsea FC'));
  assert.ok(!matchesQuery('Arsenal', 'Chelsea'));
  assert.ok(!matchesQuery('Arsenal', ''));
});

test('a fixture matches on either team or the league', () => {
  const fixture = upcoming();
  assert.ok(fixtureMatches(fixture, 'Brighton'));
  assert.ok(fixtureMatches(fixture, 'Chelsea'));
  assert.ok(fixtureMatches(fixture, 'Premier League'));
  assert.ok(!fixtureMatches(fixture, 'Bundesliga'));
});

test('dateStrings walks forward from the given day', () => {
  const dates = dateStrings(3, new Date('2026-08-30T12:00:00Z'));
  assert.deepEqual(dates, ['2026-08-30', '2026-08-31', '2026-09-01']);
});
