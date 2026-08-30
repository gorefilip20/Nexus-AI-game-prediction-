'use strict';

/**
 * Daily request-budget manager.
 *
 * The provider's limit is bound to the subscription, so the way to stay live
 * around the clock is to spend the day's allowance deliberately rather than
 * burn it in the first hours. This tracks what is left, from the provider's own
 * response headers, and decides whether a given call is worth spending on.
 *
 * Two ideas do the work:
 *
 *   Pacing — the allowance is spread across the seconds remaining in the UTC
 *   day. Running ahead of that line means low-priority work waits.
 *
 *   Reserves — each priority tier may only draw down to its own floor, so a
 *   busy afternoon of searches can never leave settlement unable to grade a
 *   finished match at midnight.
 */

const PRIORITIES = {
  // Grading a finished fixture. Skipping it corrupts the tracker permanently.
  critical: 0,
  // In-play fixtures, where the data changes minute to minute.
  high: 1,
  // The scheduled board refresh users see on load.
  normal: 2,
  // User-driven search and speculative prefetch.
  low: 3,
};

/** Fraction of the daily allowance each tier must leave untouched. */
const RESERVE_FLOOR = {
  critical: 0,
  high: 0.05,
  normal: 0.15,
  low: 0.3,
};

const DEFAULT_DAILY_LIMIT = 100;
const MS_PER_DAY = 86_400_000;

function startOfUtcDay(date) {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function parseHeaderInt(headers, name) {
  const raw = headers?.get?.(name);
  if (raw === null || raw === undefined || raw === '') return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) ? value : null;
}

class QuotaManager {
  constructor({ dailyLimit = DEFAULT_DAILY_LIMIT, logger = console, now = () => new Date() } = {}) {
    this.defaultDailyLimit = dailyLimit;
    this.logger = logger;
    this.now = now;
    this.sports = new Map();
  }

  /** Per-sport state, rolled over when the UTC day changes. */
  stateFor(sport) {
    const today = startOfUtcDay(this.now());

    let state = this.sports.get(sport);
    if (!state) {
      state = { limit: this.defaultDailyLimit, remaining: null, spent: 0, day: today, blockedUntil: 0 };
      this.sports.set(sport, state);
    }

    if (state.day !== today) {
      // The provider resets at 00:00 UTC; mirror that rather than carrying a
      // stale "exhausted" reading into a fresh allowance.
      state.day = today;
      state.spent = 0;
      state.remaining = null;
      state.blockedUntil = 0;
    }

    return state;
  }

  /**
   * Records what the provider reported. Its own count is authoritative — a
   * locally-tracked number drifts as soon as anything else shares the key.
   */
  observeHeaders(sport, headers) {
    const state = this.stateFor(sport);

    const remaining = parseHeaderInt(headers, 'x-ratelimit-requests-remaining');
    const limit = parseHeaderInt(headers, 'x-ratelimit-requests-limit');

    if (limit !== null && limit > 0) state.limit = limit;
    if (remaining !== null) state.remaining = remaining;

    state.spent += 1;

    if (state.remaining !== null && state.remaining <= 5) {
      this.logger?.warn?.(
        `Quota for ${sport} nearly exhausted: ${state.remaining} request(s) left today.`,
      );
    }

    return this.snapshot(sport);
  }

  /** Applies a 429, honouring Retry-After when the provider sends one. */
  observeRateLimited(sport, retryAfterSeconds = null) {
    const state = this.stateFor(sport);
    const waitMs = Math.max(Number(retryAfterSeconds) || 0, 60) * 1000;
    state.blockedUntil = this.now().getTime() + waitMs;

    this.logger?.warn?.(
      `${sport} rate limited; pausing its requests for ${Math.round(waitMs / 1000)}s.`,
    );

    return state.blockedUntil;
  }

  /** Requests left today: the provider's figure when known, else our estimate. */
  remainingFor(sport) {
    const state = this.stateFor(sport);
    if (state.remaining !== null) return state.remaining;
    return Math.max(state.limit - state.spent, 0);
  }

  /**
   * The pacing line: how many requests we could have spent by now and still
   * have the allowance last until the daily reset.
   */
  pacedAllowance(sport) {
    const state = this.stateFor(sport);
    const elapsed = this.now().getTime() - state.day;
    const dayFraction = Math.min(Math.max(elapsed / MS_PER_DAY, 0), 1);
    return state.limit * dayFraction;
  }

  /**
   * Whether a request at this priority should be made now.
   * @returns {{allowed: boolean, reason: string, remaining: number}}
   */
  canSpend(sport, priority = 'normal') {
    const tier = PRIORITIES[priority] === undefined ? 'normal' : priority;
    const state = this.stateFor(sport);
    const remaining = this.remainingFor(sport);
    const nowMs = this.now().getTime();

    if (state.blockedUntil > nowMs) {
      return {
        allowed: false,
        reason: `rate limited for another ${Math.ceil((state.blockedUntil - nowMs) / 1000)}s`,
        remaining,
      };
    }

    if (remaining <= 0) {
      return { allowed: false, reason: 'daily quota exhausted', remaining };
    }

    const floor = Math.ceil(state.limit * RESERVE_FLOOR[tier]);
    if (remaining <= floor) {
      return {
        allowed: false,
        reason: `holding the last ${floor} request(s) for higher-priority work`,
        remaining,
      };
    }

    // Critical work ignores pacing: a finished fixture must be graded today.
    if (tier === 'critical') return { allowed: true, reason: 'critical', remaining };

    const spent = state.limit - remaining;
    if (spent > this.pacedAllowance(sport) && tier !== 'high') {
      return {
        allowed: false,
        reason: 'ahead of the daily pace; deferring to keep the allowance lasting',
        remaining,
      };
    }

    return { allowed: true, reason: 'within budget', remaining };
  }

  snapshot(sport) {
    const state = this.stateFor(sport);
    return {
      sport,
      limit: state.limit,
      remaining: this.remainingFor(sport),
      spent: state.spent,
      pacedAllowance: Math.round(this.pacedAllowance(sport)),
      blockedUntil: state.blockedUntil || null,
    };
  }

  snapshotAll() {
    return Object.fromEntries([...this.sports.keys()].map((s) => [s, this.snapshot(s)]));
  }
}

module.exports = { QuotaManager, PRIORITIES, RESERVE_FLOOR, startOfUtcDay, parseHeaderInt };
