'use strict';

/**
 * Last-known-good board store.
 *
 * The per-sport budget resets at 00:00 UTC. If it runs out at 21:00, every
 * upstream call is refused until the reset — and without this the dashboard
 * would go blank for three hours even though a perfectly good analytical
 * breakdown was computed minutes earlier.
 *
 * So each successful board is kept in memory and served, clearly labelled as
 * cached, whenever a fresh one cannot be built. Users keep the analysis; they
 * are simply told how old it is and when live updates resume.
 *
 * In-memory by design: it is a continuity buffer, not a datastore. A restart
 * loses it, and the next successful fetch refills it.
 */

const MS_PER_DAY = 86_400_000;

/** Milliseconds until the next 00:00 UTC, when provider budgets reset. */
function msUntilUtcReset(now = new Date()) {
  const nextMidnight = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() + 1,
  );
  return Math.max(nextMidnight - now.getTime(), 0);
}

class BoardSnapshot {
  constructor({ logger = console, now = () => new Date(), maxAgeMs = MS_PER_DAY } = {}) {
    this.logger = logger;
    this.now = now;
    // Past this the analysis is about fixtures that have already been played,
    // so it is worse than showing nothing.
    this.maxAgeMs = maxAgeMs;
    this.board = null;
    this.storedAt = null;
  }

  /** Records a successfully built board. Empty boards are not worth keeping. */
  store(board) {
    if (!board || !Array.isArray(board.slips) || board.slips.length === 0) return false;

    this.board = board;
    this.storedAt = this.now();
    return true;
  }

  get ageMs() {
    if (!this.storedAt) return null;
    return this.now().getTime() - this.storedAt.getTime();
  }

  has() {
    const age = this.ageMs;
    return age !== null && age <= this.maxAgeMs;
  }

  /**
   * The stored board, annotated so the client can say what it is showing.
   * @returns {object|null} null when there is nothing usable to serve.
   */
  read(reason = 'live data unavailable') {
    if (!this.has()) return null;

    const age = this.ageMs;
    const untilReset = msUntilUtcReset(this.now());

    return {
      ...this.board,
      stale: true,
      staleReason: reason,
      cachedAt: this.storedAt.toISOString(),
      ageMs: age,
      ageSeconds: Math.round(age / 1000),
      liveUpdatesResumeInMs: untilReset,
      liveUpdatesResumeAt: new Date(this.now().getTime() + untilReset).toISOString(),
    };
  }

  clear() {
    this.board = null;
    this.storedAt = null;
  }

  describe() {
    return {
      present: this.has(),
      cachedAt: this.storedAt ? this.storedAt.toISOString() : null,
      ageSeconds: this.ageMs === null ? null : Math.round(this.ageMs / 1000),
      slipCount: this.board?.slips?.length ?? 0,
    };
  }
}

/**
 * True when a failure means "we chose not to spend budget", as opposed to a
 * genuine outage. Both fall back to the snapshot, but only the first is a
 * normal, expected state worth explaining differently to the user.
 */
function isBudgetExhaustion(error) {
  if (!error) return false;
  if (error.quotaDeferred) return true;
  return /quota|rate limit|budget|daily pace|higher-priority/i.test(error.message ?? '');
}

module.exports = { BoardSnapshot, msUntilUtcReset, isBudgetExhaustion };
