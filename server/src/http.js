'use strict';

class ProviderError extends Error {
  constructor(message, { status = null, retryable = false, cause = null, retryAfterSeconds = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable;
    this.retryAfterSeconds = retryAfterSeconds;
    if (cause) this.cause = cause;
  }
}

const RETRYABLE_STATUSES = new Set([500, 502, 503, 504]);
// Inline waits are capped: a request handler must never be held open for a
// long provider cooldown.
const MAX_INLINE_BACKOFF_MS = 5_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Seconds from a Retry-After header, which may be a delay or an HTTP date. */
function parseRetryAfter(headers) {
  const raw = headers?.get?.('retry-after');
  if (!raw) return null;

  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;

  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(Math.ceil((date - Date.now()) / 1000), 0);

  return null;
}

/**
 * API-Sports answers HTTP 200 even for auth and quota failures, reporting the
 * problem in an `errors` field that is `[]` when empty and an object when not.
 * Treating that body as success is the classic way to end up rendering an empty
 * dashboard with no explanation, so normalise it into a thrown ProviderError.
 */
function assertNoApiErrors(body) {
  const errors = body?.errors;
  if (!errors) return;

  const messages = Array.isArray(errors)
    ? errors.map(String)
    : Object.entries(errors).map(([key, value]) => `${key}: ${value}`);

  if (messages.length === 0) return;

  const text = messages.join('; ');
  const isQuota = /limit|quota|plan|subscription/i.test(text);
  throw new ProviderError(`Provider rejected the request (${text})`, {
    status: 200,
    retryable: isQuota,
  });
}

/**
 * JSON GET with a timeout and bounded retries on transient failures.
 */
async function getJson(
  url,
  {
    headers = {},
    timeoutMs = 10_000,
    retries = 2,
    fetchImpl = globalThis.fetch,
    logger,
    dispatcher,
    onRateLimited,
  } = {},
) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const request = { headers, signal: controller.signal };
      // undici reads the dispatcher off the request; passing undefined is a
      // no-op, so a direct build needs no special case.
      if (dispatcher) request.dispatcher = dispatcher;

      const response = await fetchImpl(url, request);

      if (!response.ok) {
        const retryable = RETRYABLE_STATUSES.has(response.status);

        if (response.status === 429) {
          const retryAfter = parseRetryAfter(response.headers);
          // Report the cooldown so the scheduler stops queueing this upstream,
          // then fail fast. Sleeping out a Retry-After here would pin a handler
          // open for the whole window — minutes, sometimes an hour — and every
          // concurrent caller would do the same.
          onRateLimited?.(retryAfter);
          throw new ProviderError(
            `Provider rate limited the request${retryAfter ? ` (retry after ${retryAfter}s)` : ''}`,
            { status: 429, retryable: false, retryAfterSeconds: retryAfter },
          );
        }

        throw new ProviderError(`Provider responded ${response.status}`, {
          status: response.status,
          retryable,
        });
      }

      const body = await response.json();
      assertNoApiErrors(body);
      return { body, headers: response.headers };
    } catch (err) {
      lastError =
        err.name === 'AbortError'
          ? new ProviderError(`Provider request timed out after ${timeoutMs}ms`, {
              retryable: true,
              cause: err,
            })
          : err;

      const canRetry = attempt < retries && lastError.retryable !== false;
      if (!canRetry) break;

      const backoff = Math.min(400 * 2 ** attempt, MAX_INLINE_BACKOFF_MS);
      logger?.warn?.(`Provider call failed (${lastError.message}); retrying in ${backoff}ms`);
      await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

module.exports = { getJson, assertNoApiErrors, parseRetryAfter, ProviderError };
