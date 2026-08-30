'use strict';

/**
 * TTL cache with stale-on-error fallback.
 *
 * The free API-Sports tier allows 100 requests per day per sport, so every
 * avoidable call matters. When a refresh fails we keep serving the last good
 * value (marked stale) rather than blanking the dashboard.
 */
class TtlCache {
  constructor({ now = () => Date.now() } = {}) {
    this.entries = new Map();
    this.inflight = new Map();
    this.now = now;
  }

  get(key) {
    const entry = this.entries.get(key);
    if (!entry) return null;
    return { ...entry, stale: this.now() >= entry.expiresAt };
  }

  set(key, value, ttlMs) {
    const storedAt = this.now();
    this.entries.set(key, { value, storedAt, expiresAt: storedAt + ttlMs });
    return value;
  }

  delete(key) {
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
    this.inflight.clear();
  }

  /**
   * Returns the cached value when fresh, otherwise calls `producer`.
   * Concurrent callers share one in-flight request so a burst of dashboard
   * loads cannot multiply upstream calls.
   */
  async getOrSet(key, ttlMs, producer) {
    const cached = this.get(key);
    if (cached && !cached.stale) return { value: cached.value, stale: false, cached: true };

    const existing = this.inflight.get(key);
    if (existing) return existing;

    const pending = (async () => {
      try {
        const value = await producer();
        this.set(key, value, ttlMs);
        return { value, stale: false, cached: false };
      } catch (err) {
        if (cached) return { value: cached.value, stale: true, cached: true, error: err };
        throw err;
      } finally {
        this.inflight.delete(key);
      }
    })();

    this.inflight.set(key, pending);
    return pending;
  }
}

module.exports = { TtlCache };
