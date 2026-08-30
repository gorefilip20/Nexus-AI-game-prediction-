'use strict';

/**
 * Rule-based match analysis.
 *
 * Every sentence here is generated from data the app already holds: the fitted
 * model, that league's real finished fixtures, and the live bookmaker ladder.
 * Nothing is authored by hand and nothing is written by a language model, so a
 * justification can never claim something the underlying numbers do not support.
 */

const SPORT_UNITS = {
  football: { unit: 'goals', drawPossible: true, pointsForWin: 3, pointsForDraw: 1 },
  basketball: { unit: 'points', drawPossible: false, pointsForWin: 1, pointsForDraw: 0 },
  volleyball: { unit: 'sets', drawPossible: false, pointsForWin: 1, pointsForDraw: 0 },
};

const DEFAULT_FORM_MATCHES = 6;
const DEFAULT_H2H_MATCHES = 5;

function round1(value) {
  return Math.round(value * 10) / 10;
}

function byDateDescending(a, b) {
  return new Date(b.kickoff ?? 0) - new Date(a.kickoff ?? 0);
}

/** Result of one fixture from `team`'s point of view. */
function resultFor(fixture, team) {
  const isHome = fixture.home === team;
  const scored = isHome ? fixture.homeScore : fixture.awayScore;
  const conceded = isHome ? fixture.awayScore : fixture.homeScore;
  if (typeof scored !== 'number' || typeof conceded !== 'number') return null;

  return {
    isHome,
    scored,
    conceded,
    outcome: scored > conceded ? 'W' : scored < conceded ? 'L' : 'D',
    opponent: isHome ? fixture.away : fixture.home,
    kickoff: fixture.kickoff,
  };
}

/**
 * Recent form for one team, most recent first.
 * Returns null when the team has no finished fixtures in the dataset.
 */
function computeTeamForm(history, team, { limit = DEFAULT_FORM_MATCHES, sport = 'football' } = {}) {
  const spec = SPORT_UNITS[sport] ?? SPORT_UNITS.football;

  const results = history
    .filter((f) => f.home === team || f.away === team)
    .sort(byDateDescending)
    .slice(0, limit)
    .map((f) => resultFor(f, team))
    .filter(Boolean);

  if (results.length === 0) return null;

  const won = results.filter((r) => r.outcome === 'W').length;
  const drawn = results.filter((r) => r.outcome === 'D').length;
  const lost = results.filter((r) => r.outcome === 'L').length;
  const scored = results.reduce((sum, r) => sum + r.scored, 0);
  const conceded = results.reduce((sum, r) => sum + r.conceded, 0);

  // Current unbeaten/winless run, read from the most recent match backwards.
  let streakType = results[0].outcome;
  let streakLength = 0;
  for (const result of results) {
    if (result.outcome !== streakType) break;
    streakLength += 1;
  }

  return {
    team,
    played: results.length,
    won,
    drawn,
    lost,
    scoredPerGame: round1(scored / results.length),
    concededPerGame: round1(conceded / results.length),
    pointsPerGame: round1(
      (won * spec.pointsForWin + drawn * spec.pointsForDraw) / results.length,
    ),
    winRate: round1((won / results.length) * 100),
    formString: results.map((r) => r.outcome).join(' '),
    streak: { outcome: streakType, length: streakLength },
    unit: spec.unit,
  };
}

/**
 * Prior meetings between two teams, oriented to the upcoming fixture's home side.
 */
function computeHeadToHead(history, home, away, { limit = DEFAULT_H2H_MATCHES } = {}) {
  const meetings = history
    .filter(
      (f) =>
        (f.home === home && f.away === away) || (f.home === away && f.away === home),
    )
    .sort(byDateDescending)
    .slice(0, limit);

  if (meetings.length === 0) return null;

  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let combined = 0;

  for (const fixture of meetings) {
    const result = resultFor(fixture, home);
    if (!result) continue;
    combined += result.scored + result.conceded;
    if (result.outcome === 'W') homeWins += 1;
    else if (result.outcome === 'D') draws += 1;
    else awayWins += 1;
  }

  const latest = meetings[0];

  return {
    meetings: meetings.length,
    homeWins,
    draws,
    awayWins,
    averageCombined: round1(combined / meetings.length),
    lastMeeting: {
      home: latest.home,
      away: latest.away,
      homeScore: latest.homeScore,
      awayScore: latest.awayScore,
      kickoff: latest.kickoff,
    },
  };
}

/**
 * Expected value of each outcome at the offered price.
 *
 * EV per unit staked = p_model x decimalOdds - 1. The gap against the devigged
 * market price is reported alongside, because a large EV on a long price and a
 * small disagreement with the market are very different things.
 */
function computeValueGaps(model, marketOutcomes) {
  if (!model?.outcome || !Array.isArray(marketOutcomes) || marketOutcomes.length === 0) {
    return null;
  }

  const modelByLabel = {
    Home: model.outcome.home,
    Draw: model.outcome.draw,
    Away: model.outcome.away,
  };

  const outcomes = marketOutcomes
    .map((entry) => {
      const modelProbability = modelByLabel[entry.label];
      if (modelProbability === null || modelProbability === undefined) return null;
      if (!entry.odd || entry.odd <= 1) return null;

      const probability = modelProbability / 100;
      return {
        label: entry.label,
        odd: entry.odd,
        modelProbability: round1(modelProbability),
        marketProbability: entry.impliedProbability,
        gap:
          entry.impliedProbability === null
            ? null
            : round1(modelProbability - entry.impliedProbability),
        expectedValue: round1((probability * entry.odd - 1) * 100),
      };
    })
    .filter(Boolean);

  if (outcomes.length === 0) return null;

  const best = [...outcomes].sort((a, b) => b.expectedValue - a.expectedValue)[0];
  return { outcomes, best };
}

function describeStreak(form) {
  if (form.streak.length < 2) return null;
  const word = { W: 'winning', D: 'drawing', L: 'losing' }[form.streak.outcome];
  return `on a ${form.streak.length}-match ${word} run`;
}

function formatForm(form, label) {
  if (!form) return `${label}: no finished fixtures in this dataset yet.`;

  const record = [`${form.won}W`, form.drawn ? `${form.drawn}D` : null, `${form.lost}L`]
    .filter(Boolean)
    .join(' ');
  const streak = describeStreak(form);

  return (
    `${label} — last ${form.played}: ${record} (${form.formString})` +
    `${streak ? `, ${streak}` : ''}. ` +
    `Averaging ${form.scoredPerGame} ${form.unit} scored and ` +
    `${form.concededPerGame} conceded per match.`
  );
}

function formatHeadToHead(h2h, home, away) {
  if (!h2h) return `No previous meeting between ${home} and ${away} in this dataset.`;

  const last = h2h.lastMeeting;
  const record = [
    `${home} ${h2h.homeWins}`,
    h2h.draws ? `drawn ${h2h.draws}` : null,
    `${away} ${h2h.awayWins}`,
  ]
    .filter(Boolean)
    .join(', ');

  return (
    `Last ${h2h.meetings} meeting${h2h.meetings === 1 ? '' : 's'}: ${record}, ` +
    `averaging ${h2h.averageCombined} combined. ` +
    `Most recent: ${last.home} ${last.homeScore}-${last.awayScore} ${last.away}.`
  );
}

function formatValue(value, teamsByLabel) {
  if (!value) return 'No bookmaker market available, so no value comparison is possible.';

  const best = value.best;
  const side = teamsByLabel[best.label] ?? best.label;
  const direction = best.gap === null ? '' : best.gap >= 0 ? 'above' : 'below';

  const gapClause =
    best.gap === null
      ? ''
      : ` — ${Math.abs(best.gap)} points ${direction} the devigged market price of ${best.marketProbability}%`;

  return (
    `Best value on the board is ${side} at ${best.odd}: the model makes it ` +
    `${best.modelProbability}%${gapClause}, an expected value of ` +
    `${best.expectedValue >= 0 ? '+' : ''}${best.expectedValue}% per unit staked.`
  );
}

function formatModel(model, home, away) {
  if (!model) return 'No fitted model is available for this fixture.';

  const expected = model.expected;
  return (
    `The ${model.model} fit, trained on ${model.trainedOn} finished matches, projects ` +
    `${expected.home} – ${expected.away} ${expected.unit} and rates it ` +
    `${model.outcome.home}% ${home} / ` +
    `${model.outcome.draw ? `${model.outcome.draw}% draw / ` : ''}` +
    `${model.outcome.away}% ${away}.`
  );
}

/**
 * Builds the analysis attached to a fixture.
 *
 * @returns {{bullets: Array, matchJustification: string, ...}}
 */
function buildInsight({ fixture, model = null, slip = null, history = [], sport } = {}) {
  const resolvedSport = sport ?? fixture?.sport ?? 'football';
  const home = fixture?.home ?? 'Home';
  const away = fixture?.away ?? 'Away';

  const finished = history.filter((f) => f?.status?.finished);

  const homeForm = computeTeamForm(finished, home, { sport: resolvedSport });
  const awayForm = computeTeamForm(finished, away, { sport: resolvedSport });
  const headToHead = computeHeadToHead(finished, home, away);
  const value = computeValueGaps(model, slip?.marketOutcomes ?? []);

  const bullets = [
    { category: 'Model', text: formatModel(model, home, away) },
    { category: 'Team form', text: formatForm(homeForm, home) },
    { category: 'Team form', text: formatForm(awayForm, away) },
    { category: 'Head-to-head', text: formatHeadToHead(headToHead, home, away) },
    {
      category: 'Expected value',
      text: formatValue(value, { Home: home, Away: away, Draw: 'the draw' }),
    },
  ];

  const caveats = [];
  if (model && !model.reliable) {
    caveats.push(
      `The model is fitted on only ${model.trainedOn} matches, which is a thin sample — treat these figures as provisional.`,
    );
  }
  if (!model) {
    caveats.push('No model could be fitted for this league, so only market data is shown.');
  }
  if (!value) {
    caveats.push('No priced market was returned for this fixture.');
  } else {
    caveats.push(
      'A closing betting market is usually better calibrated than a single-season model. Treat a positive gap as a prompt to look closer, not as a proven edge.',
    );
  }
  if (!headToHead) {
    caveats.push('These teams have no prior meeting in the fitted dataset.');
  }

  // The flat string is what gets persisted with the pick, so the reasoning shown
  // at the time survives alongside the settlement record.
  const matchJustification = [
    `${home} vs ${away}`,
    ...bullets.map((b) => `- ${b.category}: ${b.text}`),
    ...caveats.map((c) => `! ${c}`),
  ].join('\n');

  return {
    generatedAt: new Date().toISOString(),
    generator: 'rule-based-v1',
    sport: resolvedSport,
    form: { home: homeForm, away: awayForm },
    headToHead,
    value,
    bullets,
    caveats,
    matchJustification,
  };
}

module.exports = {
  buildInsight,
  computeTeamForm,
  computeHeadToHead,
  computeValueGaps,
  resultFor,
  SPORT_UNITS,
};
