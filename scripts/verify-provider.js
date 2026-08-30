#!/usr/bin/env node
'use strict';

/**
 * Live smoke check against the configured sports provider.
 *
 * Run this once after adding your key. It performs the same calls the server
 * makes, then prints the normalised slip beside the fields it depends on, so a
 * mismatch between the documented response shape and the live one is obvious
 * rather than silently rendering an empty board.
 *
 *   API_SPORTS_KEY=... npm run verify:provider
 *   API_SPORTS_KEY=... node scripts/verify-provider.js --sport volleyball --raw
 */

const { config } = require('../server/src/config');
const { TtlCache } = require('../server/src/cache');
const { createApiSportsProvider, SPORTS } = require('../server/src/providers/apiSports');

const args = process.argv.slice(2);
const wantRaw = args.includes('--raw');
const sportArg = args[args.indexOf('--sport') + 1];
const sports = args.includes('--sport') && SPORTS[sportArg] ? [sportArg] : Object.keys(SPORTS);

const useColour = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR;
const paint = (code) => (s) => (useColour ? `[${code}m${s}[0m` : String(s));
const bold = paint('1');
const green = paint('32');
const red = paint('31');
const yellow = paint('33');

async function main() {
  if (!config.apiSports.key) {
    console.error(red('API_SPORTS_KEY is not set.'));
    console.error('Get a free key at https://dashboard.api-football.com/register, then:');
    console.error('  API_SPORTS_KEY=your-key npm run verify:provider');
    process.exitCode = 1;
    return;
  }

  console.log(bold('\nNexusBet AI - provider verification'));
  console.log(`mode:      ${config.apiSports.mode}`);
  console.log(`per sport: ${config.apiSports.fixturesPerSport} fixture(s)`);
  console.log(`sports:    ${sports.join(', ')}\n`);

  const provider = createApiSportsProvider({
    key: config.apiSports.key,
    mode: config.apiSports.mode,
    timeoutMs: config.apiSports.timeoutMs,
    fixturesPerSport: config.apiSports.fixturesPerSport,
    bookmaker: config.apiSports.bookmaker,
    cache: new TtlCache(),
    cacheTtl: config.cache,
    logger: { warn: (m) => console.log(yellow(`  warn: ${m}`)), info() {}, error() {} },
  });

  let board;
  try {
    board = await provider.getSlips();
  } catch (err) {
    console.error(red(`\nFAILED: ${err.message}`));
    console.error('\nCommon causes:');
    console.error('  - invalid key, or a RapidAPI key used while API_SPORTS_MODE=direct');
    console.error('  - the daily free-tier quota (100 requests per sport) is spent');
    console.error('  - outbound network to *.api-sports.io is blocked');
    process.exitCode = 1;
    return;
  }

  let missingFields = 0;

  for (const sport of sports) {
    const slips = board.slips.filter((s) => s.sport === sport);
    console.log(bold(`${sport} - ${slips.length} slip(s)`));

    if (slips.length === 0) {
      console.log(yellow('  none returned. Off-season, no fixtures today, or a shape mismatch.'));
    }

    for (const slip of slips) {
      const priced = slip.oddsAvailable
        ? green(
            `${slip.prediction} @ ${slip.odd} (${slip.probability}% devigged, ${slip.bookmaker})`,
          )
        : yellow('no market odds available - slip shown unpriced');

      console.log(`  ${slip.ref}  ${slip.home} vs ${slip.away}`);
      console.log(`     league:  ${slip.league ?? red('MISSING')}`);
      console.log(`     kickoff: ${slip.kickoff ?? red('MISSING')}  status: ${slip.status.short}`);
      console.log(`     pick:    ${priced}`);

      if (!slip.league || !slip.kickoff || !slip.home || !slip.away) {
        missingFields += 1;
        console.log(red(`     ^ required field missing: check the ${sport} normaliser`));
      }
      if (wantRaw) console.log(`     raw: ${JSON.stringify(slip)}`);
    }
    console.log('');
  }

  if (board.degraded.length) {
    console.log(bold('degraded:'));
    for (const d of board.degraded) console.log(yellow(`  ${d.sport}: ${d.error}`));
    console.log('');
  }

  console.log(bold('quota remaining today:'));
  const quotaEntries = Object.entries(board.quota);
  if (quotaEntries.length === 0) console.log('  (no quota headers returned)');
  for (const [sport, q] of quotaEntries) {
    const line = `  ${sport}: ${q.remaining}`;
    console.log(q.remaining <= 10 ? red(line) : line);
  }

  const priced = board.slips.filter((s) => s.oddsAvailable).length;
  console.log(`\n${board.slips.length} fixture(s) returned, ${priced} priced.`);

  if (board.slips.length === 0) {
    console.log(red('Nothing came back - the wiring is unverified.'));
    process.exitCode = 1;
  } else if (missingFields > 0) {
    console.log(red(`${missingFields} slip(s) had missing fields - normalisers need a look.`));
    process.exitCode = 1;
  } else {
    console.log(green('Provider wiring looks correct.'));
  }
}

main().catch((err) => {
  console.error(red(err.stack));
  process.exitCode = 1;
});
