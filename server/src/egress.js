'use strict';

const { ProxyAgent, Agent } = require('undici');

/**
 * Outbound egress control for provider requests.
 *
 * Routes upstream calls through ONE stable proxy, which is what API-Sports
 * recommends for production: its abuse protection considers the source IP as
 * well as the key, so a shared or changing egress IP reduces effective capacity
 * rather than increasing it.
 *
 * This deliberately does not rotate. Rotation cannot raise a quota that is
 * bound to the subscription, and a single key arriving from many changing
 * residential IPs is the exact signature abuse protection looks for. If a
 * request budget is the problem, `quota.js` schedules within it and a paid tier
 * raises it — see PROXY_AND_QUOTA.md.
 *
 * Legitimate reasons to set one:
 *   - a NAT gateway or egress IP the provider has allowlisted
 *   - a corporate network that requires all outbound traffic to pass a proxy
 *   - pinning traffic to one region
 */

const DEFAULT_KEEPALIVE_MS = 30_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

/** Redacts credentials so a proxy URL can be logged safely. */
function describeProxy(proxyUrl) {
  try {
    const url = new URL(proxyUrl);
    const auth = url.username ? `${url.username}:***@` : '';
    return `${url.protocol}//${auth}${url.host}`;
  } catch {
    return '(unparseable proxy URL)';
  }
}

function validateProxyUrl(proxyUrl) {
  let url;
  try {
    url = new URL(proxyUrl);
  } catch {
    throw new Error(`EGRESS_PROXY_URL is not a valid URL: "${proxyUrl}"`);
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(
      `EGRESS_PROXY_URL must be http: or https:, got "${url.protocol}". ` +
        'SOCKS proxies are not supported by the HTTP dispatcher.',
    );
  }

  return url;
}

/**
 * Builds the undici dispatcher used for provider calls.
 *
 * @returns {{dispatcher: object|undefined, description: string, viaProxy: boolean}}
 */
function createEgress({ proxyUrl = null, logger = console, keepAliveMs = DEFAULT_KEEPALIVE_MS } = {}) {
  const trimmed = (proxyUrl ?? '').trim();

  if (!trimmed) {
    return {
      viaProxy: false,
      description: 'direct (no egress proxy configured)',
      // Connection reuse matters more than anything a proxy would give us:
      // every provider call is HTTPS to the same few hosts.
      dispatcher: new Agent({
        keepAliveTimeout: keepAliveMs,
        keepAliveMaxTimeout: keepAliveMs * 2,
        connectTimeout: DEFAULT_CONNECT_TIMEOUT_MS,
      }),
    };
  }

  const url = validateProxyUrl(trimmed);
  const description = describeProxy(trimmed);

  const dispatcher = new ProxyAgent({
    uri: `${url.protocol}//${url.host}`,
    token: url.username
      ? `Basic ${Buffer.from(`${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`).toString('base64')}`
      : undefined,
    keepAliveTimeout: keepAliveMs,
    keepAliveMaxTimeout: keepAliveMs * 2,
    connectTimeout: DEFAULT_CONNECT_TIMEOUT_MS,
  });

  logger?.info?.(`Provider egress routed via ${description}`);

  return { viaProxy: true, description, dispatcher };
}

module.exports = { createEgress, describeProxy, validateProxyUrl };
