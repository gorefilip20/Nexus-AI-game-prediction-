#!/usr/bin/env node
'use strict';

/**
 * Measures the model's real accuracy on a league's actual results.
 *
 * Fits on the earlier part of the season and scores the later part, so nothing
 * is graded on fixtures it was trained on. The output answers the only question
 * that matters for a strike-rate target: at what confidence level does the model
 * reach it, and how many picks are left once you filter that hard.
 *
 *   API_SPORTS_KEY=... npm run backtest -- --league 39 --season 2026
 *   API_SPORTS_KEY=... node scripts/backtest.js --sport basketball --league 12 --season 2025-2026
 */

const { config } = require('../server/src/config');
const { TtlCache } = require('../server/src/cache');
const { createApiSportsProvider, SPORT_NAMES } = require('../server/src/providers/apiSports');
const { runBacktest } = require('../server/src/backtest');

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--sport') args.sport = argv[++i];
    else if (argv[i] === '--league') args.league = argv[++i];
    else if (argv[i] === '--season') args.season = argv[++i];
    else if (argv[i] === '--folds') args.folds = Number(argv[++i]);
    else if (argv[i] === '--min-train') args.minTrain = Number(argv[++i]);
  }
  return args;
}

const useColour = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColour ? `[${code}m${s}[0m` : String(s));
const bold = paint('1');
const green = paint('32');
const yellow = paint('33');
const red = paint('31');

const pad = (v, n) => String(v).padStart(n);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sport = SPORT_NAMES.includes(args.sport) ? args.sport : 'football';

  if (!config.apiSports.key) {
    console.error(red('API_SPORTS_KEY is not set. A backtest needs real results.'));
    console.error('  API_SPORTS_KEY=your-key npm run backtest -- --league 39 --season 2026');
    process.exitCode = 1;
    return;
  }

  if (!args.league || !args.season) {
    console.error('Usage: node scripts/backtest.js --league <id> --season <season> [--sport football]');
    console.error('  Find league ids in the provider dashboard, e.g. 39 = Premier League.');
    process.exitCode = 1;
    return;
  }

  const provider = createApiSportsProvider({
    key: config.apiSports.key,
    mode: config.apiSports.mode,
    timeoutMs: config.apiSports.timeoutMs,
    cache: new TtlCache(),
    cacheTtl: config.cache,
    logger: { warn: (m) => console.log(yellow(`  warn: ${m}`)), info() {}, error() {} },
  });

  console.log(bold(`\nBacktest — ${sport}, league ${args.league}, season ${args.season}`));
  console.log('='.repeat(68));
  console.log('Fetching finished fixtures...');

  const history = await provider.getHistory(sport, args.league, args.season);
  console.log(`  ${history.length} finished fixture(s).\n`);

  const result = runBacktest(sport, history, {
    folds: args.folds ?? 4,
    minTrain: args.minTrain ?? 60,
  });

  if (!result.ok) {
    console.log(red(`Cannot score this league: ${result.reason}`));
    console.log('Try a league further into its season, or a completed past season.');
    process.exitCode = 1;
    return;
  }

  console.log(bold('Overall (on fixtures the model never saw)'));
  console.log('-'.repeat(68));
  console.log(`  fixtures scored     ${result.predictionsScored}`);
  console.log(`  accuracy            ${result.accuracy}%`);
  console.log(`  always-home baseline ${result.homeBaseline}%`);
  console.log(`  Brier score         ${result.brier}   (lower is better; 0.667 = guessing)`);
  console.log(`  log loss            ${result.logLoss}`);

  const beatsBaseline = result.accuracy > result.homeBaseline;
  console.log(
    `  -> ${beatsBaseline ? green('beats') : red('does NOT beat')} simply backing the home team`,
  );

  console.log(bold('\nStrike rate by confidence filter'));
  console.log('-'.repeat(68));
  console.log('  minConf   picks   coverage   strikeRate');
  for (const row of result.byThreshold) {
    const rate = row.strikeRate === null ? '-' : `${row.strikeRate}%`;
    const line = `  ${pad(row.minConfidence + '%', 7)} ${pad(row.picks, 7)} ${pad(row.coverage + '%', 10)} ${pad(rate, 12)}`;
    console.log(row.strikeRate !== null && row.strikeRate >= 80 ? green(line) : line);
  }

  const eighty = result.byThreshold.find((r) => r.strikeRate !== null && r.strikeRate >= 80);
  console.log('');
  if (eighty) {
    console.log(
      green(
        `  An 80% strike rate needs a ${eighty.minConfidence}% confidence filter, ` +
          `which keeps ${eighty.coverage}% of fixtures (${eighty.picks} picks).`,
      ),
    );
  } else {
    console.log(yellow('  No confidence level reached an 80% strike rate on this sample.'));
  }

  console.log(bold('\nCalibration — does a stated 70% actually happen 70% of the time?'));
  console.log('-'.repeat(68));
  console.log('  range         picks   predicted   observed   gap');
  for (const bin of result.calibration) {
    const gap = bin.overconfidencePoints;
    const line = `  ${bin.range.padEnd(12)} ${pad(bin.picks, 6)} ${pad(bin.meanPredicted + '%', 11)} ${pad(bin.observed + '%', 10)} ${pad(gap, 6)}`;
    console.log(Math.abs(gap) > 7 ? yellow(line) : line);
  }
  console.log('\n  A positive gap means the model claimed more confidence than it earned.');

  console.log(
    bold('\nWhat this does and does not tell you') + '\n' +
      '  A high strike rate is not the same as profit. Filtering to strong\n' +
      '  favourites raises the hit rate, but those price near 1.20, where you\n' +
      '  need roughly 83% just to break even. Judge picks on price against\n' +
      '  probability, not on strike rate alone.\n',
  );
}

main().catch((err) => {
  console.error(err.stack);
  process.exitCode = 1;
});
