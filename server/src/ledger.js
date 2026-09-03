'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');

const { computePerformance } = require('./performance');

const DEFAULT_PATH = path.join(__dirname, '..', 'data', 'ledger.json');

/** Actual outcome label for a finished fixture, or null when it is unscored. */
function winnerLabel(fixture) {
  const home = fixture?.homeScore;
  const away = fixture?.awayScore;
  if (typeof home !== 'number' || typeof away !== 'number') return null;
  if (home > away) return 'Home';
  if (away > home) return 'Away';
  return 'Draw';
}

/**
 * A record of the picks this app actually surfaced, and how they settled.
 *
 * No sports API can report "your win rate" — it only knows fixtures and
 * results. A truthful accuracy figure therefore requires writing each pick down
 * before kickoff and grading it afterwards, which is what this store does. An
 * empty ledger reports no win rate at all rather than inventing one.
 */
class PredictionLedger {
  constructor({ filePath = DEFAULT_PATH, logger = console, now = () => new Date() } = {}) {
    this.filePath = filePath;
    this.logger = logger;
    this.now = now;
    this.entries = new Map();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return;
    try {
      const raw = await fsp.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      for (const entry of parsed.entries ?? []) this.entries.set(entry.key, entry);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.logger?.warn?.(`Could not read ledger at ${this.filePath}: ${err.message}`);
      }
    }
    this.loaded = true;
  }

  /** Atomic write so a crash mid-save cannot truncate the ledger. */
  async save() {
    const payload = JSON.stringify(
      { version: 1, updatedAt: this.now().toISOString(), entries: [...this.entries.values()] },
      null,
      2,
    );

    await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await fsp.writeFile(tmp, payload, 'utf8');
    await fsp.rename(tmp, this.filePath);
  }

  /**
   * Writes down every genuinely-priced slip the board showed, once.
   * Re-recording a fixture would let a later, better price overwrite the pick
   * that was actually displayed, so existing keys are left untouched.
   */
  record(slips) {
    let added = 0;

    for (const slip of slips) {
      if (!slip.oddsAvailable || !slip.pickLabel || !slip.id) continue;
      const key = `${slip.sport}:${slip.id}`;
      if (this.entries.has(key)) continue;

      this.entries.set(key, {
        key,
        sport: slip.sport,
        id: slip.id,
        ref: slip.ref,
        league: slip.league,
        match: `${slip.home} vs ${slip.away}`,
        home: slip.home,
        away: slip.away,
        kickoff: slip.kickoff,
        prediction: slip.prediction,
        pickLabel: slip.pickLabel,
        probability: slip.probability,
        odd: slip.odd,
        bookmaker: slip.bookmaker,
        // The reasoning shown at the time is kept with the pick, so a settled
        // result can be read back against the analysis that justified it.
        justification: slip.matchJustification ?? null,
        recordedAt: this.now().toISOString(),
        status: 'PENDING',
        settledAt: null,
        result: null,
        // Set once a settlement notification has been delivered, so a repeated
        // settlement pass cannot send the same card twice.
        notifiedAt: null,
      });
      added += 1;
    }

    return added;
  }

  /** Keys still awaiting a result, for the settlement pass to look up. */
  pendingReferences() {
    return [...this.entries.values()]
      .filter((entry) => entry.status === 'PENDING')
      .map(({ sport, id }) => ({ sport, id }));
  }

  /**
   * Grades pending picks against finished fixtures.
   * @returns {{settled: number, entries: object[]}} the entries just graded, so
   *   the caller can notify on them without rescanning the whole ledger.
   */
  settle(results) {
    const graded = [];

    for (const entry of this.entries.values()) {
      if (entry.status !== 'PENDING') continue;

      const fixture = results.get(entry.key);
      if (!fixture || !fixture.status?.finished) continue;

      const actual = winnerLabel(fixture);
      entry.settledAt = this.now().toISOString();
      entry.result = {
        homeScore: fixture.homeScore,
        awayScore: fixture.awayScore,
        status: fixture.status.short,
      };
      // An unscored "finished" fixture (abandoned, walkover) grades as VOID so
      // it neither flatters nor penalises the record.
      entry.status = actual === null ? 'VOID' : actual === entry.pickLabel ? 'WIN' : 'LOSS';
      graded.push(entry);
    }

    return { settled: graded.length, entries: graded };
  }

  /** Entries that settled but whose notification has not been delivered yet. */
  unnotified(statuses = ['WIN']) {
    const wanted = new Set(statuses.map((s) => String(s).toUpperCase()));
    return [...this.entries.values()].filter(
      (entry) => !entry.notifiedAt && wanted.has(String(entry.status).toUpperCase()),
    );
  }

  /** Tracker figures derived entirely from settled picks. */
  summary() {
    const all = [...this.entries.values()];
    const graded = all
      .filter((e) => e.status === 'WIN' || e.status === 'LOSS')
      .sort((a, b) => new Date(b.settledAt) - new Date(a.settledAt));

    const wins = graded.filter((e) => e.status === 'WIN').length;
    const losses = graded.length - wins;

    let streak = 0;
    for (const entry of graded) {
      if (entry.status !== 'WIN') break;
      streak += 1;
    }

    return {
      live: true,
      sampleData: false,
      // Staked return on the real recorded prices. Strike rate says how often
      // we were right; this says whether being right was worth anything.
      performance: computePerformance(all),
      settledCount: graded.length,
      pendingCount: all.filter((e) => e.status === 'PENDING').length,
      voidCount: all.filter((e) => e.status === 'VOID').length,
      wins,
      losses,
      // Null, not zero: with nothing settled there is no win rate to report.
      winRate: graded.length ? Math.round((wins / graded.length) * 1000) / 10 : null,
      currentStreak: streak,
      rows: all
        .sort(
          (a, b) =>
            new Date(b.settledAt ?? b.recordedAt) - new Date(a.settledAt ?? a.recordedAt),
        )
        .slice(0, 50),
    };
  }
}

module.exports = { PredictionLedger, winnerLabel, DEFAULT_PATH };
