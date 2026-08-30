#!/usr/bin/env node
'use strict';

/**
 * Runs the probability engine against one named fixture on a given date.
 *
 * Built for checks like "Chelsea vs Brighton today": it finds the real fixture
 * in the provider's schedule, fits that league's model on its real finished
 * matches, and prints the resulting market probabilities.
 *
 * If the fixture is not on the schedule, it says so and lists what is. It never
 * invents a match or a number - an absent fixture is a finding, not something to
 * paper over.
 *
 *   API_SPORTS_KEY=... npm run scenario -- "Chelsea vs Brighton"
 *   API_SPORTS_KEY=... node scripts/scenario.js "Lakers vs Celtics" --sport basketball
 *   API_SPORTS_KEY=... node scripts/scenario.js "Italy vs Brazil" --date 2026-09-01
 */

const { config } = require('../server/src/config');
const { TtlCache } = require('../server/src/cache');
const { createApiSportsProvider, SPORT_NAMES } = require('../server/src/providers/apiSports');
const { runScenario, withMarketComparison } = require('../server/src/scenario');

function parseArgs(argv) {
  const args = { positional: [] };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--sport') args.sport = argv[++i];
    else if (argv[i] === '--date') args.date = argv[++i];
    else if (argv[i] === '--home') args.home = argv[++i];
    else if (argv[i] === '--away') args.away = argv[++i];
    else args.positional.push(argv[i]);
  }

  if (!args.home && args.positional.length) {
    const [home, away] = args.positional.join(' ').split(/\s+vs\.?\s+/i);
    args.home = home?.trim();
    args.away = away?.trim();
  }

  return args;
}

const pct = (value) =>
  value === null || value === undefined ? '   n/a' : `${value.toFixed(1).padStart(5)}%`;

const line = (label, value) => console.log(`  ${label.padEnd(26)} ${value}`);
const rule = () => console.log('-'.repeat(64));

function printNotScheduled(result) {
  console.log(
    `\nNo fixture matching "${result.query.home} vs ${result.query.away}" is scheduled on ${result.date}.`,
  );
  console.log('The engine will not produce probabilities for a match that is not on.\n');

  for (const failure of result.scheduleErrors ?? []) {
    console.log(`  note: ${failure.sport} schedule unavailable (${failure.error})`);
  }

  if (result.scanned.length) {
    console.log(`\nFixtures actually scheduled that day (${result.scanned.length}):`);
    for (const f of result.scanned.slice(0, 25)) {
      console.log(`  ${f.sport}: ${f.home} vs ${f.away} (${f.league})`);
    }
    if (result.scanned.length > 25) {
      console.log(`  ...and ${result.scanned.length - 25} more`);
    }
  } else {
    console.log('No fixtures were returned at all for that date.');
  }

  console.log('\nTry another date with --date YYYY-MM-DD.');
}

function printFixture(fixture) {
  console.log(`\nFixture found: ${fixture.home} vs ${fixture.away}`);
  line('sport', fixture.sport);
  line('league', `${fixture.league} (id ${fixture.leagueId}, season ${fixture.season})`);
  line('kickoff', fixture.kickoff ?? 'unknown');
  line('status', `${fixture.status.long} [${fixture.status.short}]`);
}

function printMarkets(result) {
  const { markets } = result;

  console.log(`\nModel: ${markets.model}  (trained on ${markets.trainedOn} matches)`);
  if (!markets.reliable) {
    console.log('  WARNING: thin training sample - treat these numbers as provisional.');
  }

  console.log('\nStructural outcome probabilities');
  rule();
  line('Home win', pct(markets.outcome.home));
  if (markets.outcome.draw) line('Draw', pct(markets.outcome.draw));
  line('Away win', pct(markets.outcome.away));
  line(`Expected (${markets.expected.unit})`, `${markets.expected.home} - ${markets.expected.away}`);

  if (markets.totals.length) {
    console.log('\nTotals');
    rule();
    for (const t of markets.totals) {
      line(`Over/Under ${t.line}`, `over ${pct(t.over)}   under ${pct(t.under)}`);
    }
  }

  if (markets.handicaps.length) {
    console.log('\nHandicaps (applied to home)');
    rule();
    for (const h of markets.handicaps) {
      line(`Handicap ${h.handicap}`, `home ${pct(h.home)}   away ${pct(h.away)}`);
    }
  }

  if (markets.btts) {
    console.log('\nBoth teams to score');
    rule();
    line('Yes / No', `${pct(markets.btts.yes)} / ${pct(markets.btts.no)}`);
  }

  if (markets.scorelines.length) {
    console.log('\nMost likely scorelines');
    rule();
    for (const s of markets.scorelines) line(`${s.home} - ${s.away}`, pct(s.probability));
  }

  if (result.comparison) {
    console.log('\nModel vs market');
    rule();
    line(
      'Market favourite',
      `${result.comparison.favourite} @ ${result.comparison.odd} (${result.comparison.bookmaker})`,
    );
    line('Market implied', pct(result.comparison.marketImplied));
    line('Model on that side', pct(result.comparison.modelOnSide));
    if (result.comparison.edge !== null) {
      const sign = result.comparison.edge >= 0 ? '+' : '';
      line('Edge (model - market)', `${sign}${result.comparison.edge} points`);
    }
  }

  console.log('\nSlip reference');
  rule();
  line('Code', result.slipCode ?? 'unavailable');
  console.log(
    '\n  This is a NexusBet internal reference that decodes back to this fixture\n' +
      '  and selection. It is not a sportsbook booking code and will not load a\n' +
      '  bet slip on Stake or anywhere else.\n',
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.home || !args.away) {
    console.error(
      'Usage: node scripts/scenario.js "Chelsea vs Brighton" [--sport football] [--date YYYY-MM-DD]',
    );
    process.exitCode = 1;
    return;
  }

  if (!config.apiSports.key) {
    console.error('API_SPORTS_KEY is not set. This scenario needs live provider data.');
    console.error('Get a free key at https://dashboard.api-football.com/register, then:');
    console.error(`  API_SPORTS_KEY=your-key npm run scenario -- "${args.home} vs ${args.away}"`);
    process.exitCode = 1;
    return;
  }

  const date = args.date ?? new Date().toISOString().slice(0, 10);

  const provider = createApiSportsProvider({
    key: config.apiSports.key,
    mode: config.apiSports.mode,
    timeoutMs: config.apiSports.timeoutMs,
    bookmaker: config.apiSports.bookmaker,
    cache: new TtlCache(),
    cacheTtl: config.cache,
    logger: { warn: (m) => console.log(`  warn: ${m}`), info() {}, error() {} },
  });

  console.log(`\nScenario: ${args.home} vs ${args.away}   (${date}, UTC)`);
  console.log('='.repeat(64));

  const sport = args.sport && SPORT_NAMES.includes(args.sport) ? args.sport : null;
  let result = await runScenario({
    provider,
    home: args.home,
    away: args.away,
    sport,
    date,
    logger: { warn: (m) => console.log(`  warn: ${m}`) },
  });

  if (result.status === 'not_scheduled') {
    printNotScheduled(result);
    process.exitCode = 1;
    return;
  }

  printFixture(result.fixture);

  if (result.status === 'no_history') {
    console.log('\nNo completed matches in this league this season, so there is nothing to fit.');
    console.log('The engine reports no probability rather than guessing one.');
    process.exitCode = 1;
    return;
  }

  if (result.status === 'fit_failed') {
    console.log(`\nModel could not be fitted: ${result.reason}`);
    process.exitCode = 1;
    return;
  }

  if (result.status === 'unrated_team') {
    console.log('\nOne of these teams does not appear in the training data, so the model');
    console.log('cannot rate them. No probability is produced.');
    process.exitCode = 1;
    return;
  }

  console.log(`\nFitted on ${result.historyCount} finished fixture(s) from this league.`);
  result = await withMarketComparison(result, provider);
  printMarkets(result);
}

main().catch((err) => {
  console.error(err.stack);
  process.exitCode = 1;
});
