'use strict';

class ProviderError extends Error {
  constructor(message, { status = null, retryable = false, cause = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable;
    if (cause) this.cause = cause;
  }
}

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
  { headers = {}, timeoutMs = 10_000, retries = 2, fetchImpl = globalThis.fetch, logger } = {},
) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetchImpl(url, { headers, signal: controller.signal });

      if (!response.ok) {
        const retryable = RETRYABLE_STATUSES.has(response.status);
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

      const backoff = 400 * 2 ** attempt;
      logger?.warn?.(`Provider call failed (${lastError.message}); retrying in ${backoff}ms`);
      await sleep(backoff);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError;
}

module.exports = { getJson, assertNoApiErrors, ProviderError };
