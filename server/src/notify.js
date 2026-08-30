'use strict';

const { getJson } = require('./http');

/**
 * Outbound settlement notifications.
 *
 * When a recorded pick grades, this pushes a structured card to the configured
 * channels. Two rules shape the design:
 *
 *   Never block settlement. Grading the ledger is the source of truth; a
 *   Telegram outage must not stop a fixture being settled or retry it forever.
 *   Delivery failures are logged and the pick is left unnotified for the next
 *   pass to pick up.
 *
 *   Never send twice. Settlement runs on a timer and can be triggered manually,
 *   so an entry carries `notifiedAt` and is skipped once delivered.
 */

const TELEGRAM_API = 'https://api.telegram.org';
const DEFAULT_TIMEOUT_MS = 8_000;
const MAX_BATCH = 20;

/** Escapes the five characters Telegram's HTML parse mode treats as markup. */
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const STATUS_ICON = { WIN: '✅', LOSS: '❌', VOID: '⚪' };

/**
 * Builds the card body.
 *
 * The running settled record is always included. A feed of wins with no
 * denominator reads as an unbroken run whatever the real record is, and the
 * tracker already refuses to overstate itself — a notification should not
 * undo that.
 */
function formatCard(entry, summary = null) {
  const icon = STATUS_ICON[entry.status] ?? '•';
  const lines = [];

  lines.push(`${icon} <b>${escapeHtml(entry.status)}</b> — ${escapeHtml(entry.prediction)}`);
  lines.push(`<b>${escapeHtml(entry.match)}</b>`);

  const context = [entry.league, entry.sport].filter(Boolean).map(escapeHtml).join(' · ');
  if (context) lines.push(context);

  if (entry.result && entry.result.homeScore !== null && entry.result.awayScore !== null) {
    lines.push(`Final: <b>${entry.result.homeScore}–${entry.result.awayScore}</b>`);
  }

  const priced = [];
  if (entry.odd) priced.push(`Price ${escapeHtml(entry.odd)}`);
  if (entry.probability !== null && entry.probability !== undefined) {
    priced.push(`model had ${escapeHtml(entry.probability)}%`);
  }
  if (entry.bookmaker) priced.push(escapeHtml(entry.bookmaker));
  if (priced.length) lines.push(priced.join(' · '));

  if (summary && summary.settledCount > 0) {
    lines.push(
      `\nSettled record: <b>${summary.wins}W–${summary.losses}L</b> ` +
        `(${summary.winRate}% over ${summary.settledCount})`,
    );
  }

  return lines.join('\n');
}

/** The same settlement as machine-readable JSON, for a generic webhook. */
function buildPayload(entry, summary = null) {
  return {
    event: 'prediction.settled',
    status: entry.status,
    settledAt: entry.settledAt,
    pick: {
      key: entry.key,
      sport: entry.sport,
      league: entry.league,
      match: entry.match,
      home: entry.home,
      away: entry.away,
      prediction: entry.prediction,
      selection: entry.pickLabel,
      odd: entry.odd,
      modelProbability: entry.probability,
      bookmaker: entry.bookmaker,
      recordedAt: entry.recordedAt,
    },
    result: entry.result,
    record: summary
      ? {
          wins: summary.wins,
          losses: summary.losses,
          settled: summary.settledCount,
          winRate: summary.winRate,
        }
      : null,
  };
}

/** Posts a chat message via the Telegram Bot API. */
function createTelegramChannel({ botToken, chatId, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl, logger }) {
  if (!botToken || !chatId) throw new Error('Telegram channel needs both a bot token and a chat id');

  return {
    name: 'telegram',
    async send(entry, summary) {
      const url = `${TELEGRAM_API}/bot${botToken}/sendMessage`;
      const body = {
        chat_id: chatId,
        text: formatCard(entry, summary),
        parse_mode: 'HTML',
        disable_web_page_preview: true,
      };

      const response = await (fetchImpl ?? globalThis.fetch)(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      // Telegram answers 200 with ok:false for logical failures such as a bad
      // chat id, so the status code alone is not enough.
      const payload = await response.json().catch(() => null);
      if (!response.ok || payload?.ok === false) {
        throw new Error(
          `Telegram rejected the message: ${payload?.description ?? response.status}`,
        );
      }

      logger?.debug?.(`Notified Telegram about ${entry.key}`);
      return { channel: 'telegram', ok: true };
    },
  };
}

/** POSTs the structured payload to any HTTP endpoint (Slack, Discord, a push relay). */
function createWebhookChannel({ url, headers = {}, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl, logger }) {
  if (!url) throw new Error('Webhook channel needs a URL');

  return {
    name: 'webhook',
    async send(entry, summary) {
      const response = await (fetchImpl ?? globalThis.fetch)(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(buildPayload(entry, summary)),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) throw new Error(`Webhook responded ${response.status}`);

      logger?.debug?.(`Notified webhook about ${entry.key}`);
      return { channel: 'webhook', ok: true };
    },
  };
}

/**
 * Fans settled picks out to every configured channel.
 *
 * @param {object} options
 * @param {string[]} options.statuses  Which settlement outcomes notify. Defaults
 *   to WIN only, matching the product spec; add LOSS for a complete feed.
 */
function createNotifier({
  channels = [],
  statuses = ['WIN'],
  logger = console,
  now = () => new Date(),
} = {}) {
  const wanted = new Set(statuses.map((s) => String(s).toUpperCase()));

  return {
    enabled: channels.length > 0,
    channelNames: channels.map((c) => c.name),
    statuses: [...wanted],

    /** True when this entry should produce a notification and has not yet. */
    shouldNotify(entry) {
      if (!entry || entry.notifiedAt) return false;
      return wanted.has(String(entry.status).toUpperCase());
    },

    /**
     * Sends for every eligible entry.
     *
     * Marks `notifiedAt` only when at least one channel accepted, so a total
     * outage leaves the pick queued for the next settlement pass rather than
     * silently dropping it. Never throws.
     */
    async notifySettled(entries = [], summary = null) {
      if (!this.enabled) return { sent: 0, failed: 0, skipped: entries.length, results: [] };

      try {

        const eligible = entries.filter((entry) => this.shouldNotify(entry)).slice(0, MAX_BATCH);
        if (eligible.length === 0) {
        return { sent: 0, failed: 0, skipped: entries.length, results: [] };
        }

        let sent = 0;
        let failed = 0;
        const results = [];

        for (const entry of eligible) {
        // Promise.resolve().then(...) so a channel that throws synchronously
        // becomes a rejected promise rather than escaping allSettled and
        // taking settlement down with it.
        const outcomes = await Promise.allSettled(
          channels.map((channel) =>
            Promise.resolve().then(() => channel.send(entry, summary)),
          ),
        );

        const delivered = outcomes.filter((o) => o.status === 'fulfilled').length;

        for (const [index, outcome] of outcomes.entries()) {
          if (outcome.status === 'rejected') {
            logger?.warn?.(
              `Notification to ${channels[index].name} failed for ${entry.key}: ${outcome.reason?.message}`,
            );
          }
        }

        if (delivered > 0) {
          entry.notifiedAt = now().toISOString();
          sent += 1;
        } else {
          failed += 1;
        }

        results.push({ key: entry.key, delivered, channels: channels.length });
        }

        return { sent, failed, skipped: entries.length - eligible.length, results };
      } catch (err) {
        // The contract is that settlement is never taken down by notification.
        logger?.error?.(`Notification pass failed: ${err.message}`);
        return { sent: 0, failed: entries.length, skipped: 0, results: [], error: err.message };
      }
    },
  };
}

/** Builds the configured channel set; an unconfigured channel is simply absent. */
function createChannelsFromConfig(notifications = {}, { logger = console, fetchImpl } = {}) {
  const channels = [];

  if (notifications.telegram?.botToken && notifications.telegram?.chatId) {
    channels.push(
      createTelegramChannel({ ...notifications.telegram, logger, fetchImpl }),
    );
  }

  if (notifications.webhook?.url) {
    channels.push(createWebhookChannel({ ...notifications.webhook, logger, fetchImpl }));
  }

  return channels;
}

module.exports = {
  createNotifier,
  createTelegramChannel,
  createWebhookChannel,
  createChannelsFromConfig,
  formatCard,
  buildPayload,
  escapeHtml,
};
