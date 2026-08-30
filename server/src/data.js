'use strict';

/**
 * Sample fixture data for the demo build.
 *
 * Everything below is illustrative seed content, not the output of a model and
 * not a record of real settled wagers. Swap this module for a real data source
 * before the numbers are shown to anyone as fact.
 */

const predictions = [
  {
    id: 1,
    sport: 'Football',
    league: 'English Premier League',
    match: 'Arsenal vs Chelsea',
    prediction: 'Arsenal to Win (1)',
    score: '2 - 1',
    prob: 78,
    code: 'STK-ARS-77X',
  },
  {
    id: 2,
    sport: 'Basketball',
    league: 'NBA',
    match: 'LA Lakers vs Boston Celtics',
    prediction: 'Over 224.5 Points',
    score: 'N/A',
    prob: 84,
    code: 'STK-LAL-224',
  },
  {
    id: 3,
    sport: 'Volleyball',
    league: 'FIVB Nations League',
    match: 'Italy vs Brazil',
    prediction: 'Italy -1.5 Set Handicap',
    score: '3 - 1',
    prob: 69,
    code: 'STK-ITA-SET',
  },
];

const pastResults = [
  {
    id: 101,
    sport: 'Football',
    league: 'Champions League',
    match: 'Real Madrid vs Man City',
    pick: 'GG (Both Teams Score)',
    odds: '1.65',
    status: 'WIN',
  },
  {
    id: 102,
    sport: 'Basketball',
    league: 'NBA',
    match: 'Golden State vs Miami Heat',
    pick: 'Golden State Moneyline',
    odds: '1.80',
    status: 'WIN',
  },
  {
    id: 103,
    sport: 'Volleyball',
    league: 'SuperLega',
    match: 'Sir Safety Perugia vs Lube Civitanova',
    pick: 'Under 185.5 Points',
    odds: '1.90',
    status: 'LOSS',
  },
  {
    id: 104,
    sport: 'Football',
    league: 'La Liga',
    match: 'Barcelona vs Atletico Madrid',
    pick: 'Under 2.5 Goals',
    odds: '1.75',
    status: 'WIN',
  },
];

/**
 * Derives the headline tracker numbers from `pastResults` rather than hardcoding
 * them, so the panel can never advertise a win rate the audit table contradicts.
 */
function buildAccuracyHistory(results = pastResults) {
  const wins = results.filter((r) => r.status === 'WIN').length;
  const winRate = results.length ? (wins / results.length) * 100 : 0;

  let streak = 0;
  for (const result of results) {
    if (result.status !== 'WIN') break;
    streak += 1;
  }

  return {
    overallWinRate: `${winRate.toFixed(1)}%`,
    currentStreak: streak === 1 ? '1 Win Row' : `${streak} Wins Row`,
    totalBetsAnalyzed: results.length,
    sampleData: true,
    pastResults: results,
  };
}

module.exports = {
  predictions,
  pastResults,
  buildAccuracyHistory,
};

/**
 * Presents the sample tracker in the same shape the live ledger returns, so the
 * client renders one contract regardless of which provider is configured.
 */
function sampleTrackerSummary() {
  const derived = buildAccuracyHistory();
  const wins = pastResults.filter((r) => r.status === 'WIN').length;

  return {
    live: false,
    sampleData: true,
    winRate: Number.parseFloat(derived.overallWinRate),
    currentStreak: Number.parseInt(derived.currentStreak, 10) || 0,
    settledCount: pastResults.length,
    pendingCount: 0,
    voidCount: 0,
    wins,
    losses: pastResults.length - wins,
    rows: pastResults.map((row) => ({
      key: `sample:${row.id}`,
      sport: row.sport.toLowerCase(),
      league: row.league,
      match: row.match,
      prediction: row.pick,
      odd: Number.parseFloat(row.odds),
      probability: null,
      bookmaker: null,
      status: row.status,
      kickoff: null,
      settledAt: null,
    })),
  };
}

module.exports.sampleTrackerSummary = sampleTrackerSummary;
