'use strict';

const MAX_MESSAGE_LENGTH = 500;
const MAX_USERNAME_LENGTH = 32;
const MAX_TAG_LENGTH = 24;
const HISTORY_LIMIT = 50;
const RATE_LIMIT_WINDOW_MS = 10_000;
const RATE_LIMIT_MAX_MESSAGES = 8;
const HEARTBEAT_INTERVAL_MS = 30_000;

const seedMessages = [
  {
    id: 1,
    user: 'StakePunter_99',
    time: '12:32 PM',
    msg: 'Just copied the Arsenal slip code into my sportsbook. Let’s see how it lands.',
    tag: 'STK-ARS-77X',
  },
  {
    id: 2,
    user: 'AlphaBet_AI',
    time: '12:34 PM',
    msg: 'The Lakers match line just shifted by 2 points since the model last refreshed.',
    tag: null,
  },
  {
    id: 3,
    user: 'Vera_Goshen',
    time: '12:35 PM',
    msg: 'Reminder that the tracker numbers on this build are sample data, not settled results.',
    tag: null,
  },
];

/** Collapses whitespace and hard-caps length so one client cannot flood the room. */
function sanitiseText(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function formatTime(date = new Date()) {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * Owns every live punter-lounge socket: validation, rate limiting, fan-out,
 * presence counts and dead-connection reaping.
 */
class PunterLounge {
  constructor({ logger } = {}) {
    this.logger = logger ?? console;
    this.clients = new Map();
    this.history = [...seedMessages];
    this.nextId = seedMessages.length + 1;
    this.heartbeat = null;
  }

  get size() {
    return this.clients.size;
  }

  start() {
    if (this.heartbeat) return;
    this.heartbeat = setInterval(() => this.reapStaleSockets(), HEARTBEAT_INTERVAL_MS);
    this.heartbeat.unref?.();
  }

  stop() {
    if (!this.heartbeat) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  add(socket) {
    this.clients.set(socket, { alive: true, timestamps: [] });

    socket.on('pong', () => {
      const state = this.clients.get(socket);
      if (state) state.alive = true;
    });

    this.sendTo(socket, { type: 'history', messages: this.history });
    this.broadcastPresence();
    this.logger.info?.(`New connection established. Global users: ${this.size}`);
  }

  remove(socket) {
    if (!this.clients.delete(socket)) return;
    this.broadcastPresence();
    this.logger.info?.(`Client connection closed. Active tracking list: ${this.size}`);
  }

  /** Returns the broadcast message, or null when the payload was rejected. */
  handleIncoming(socket, rawPayload) {
    const state = this.clients.get(socket);
    if (!state) return null;

    if (this.isRateLimited(state)) {
      this.sendTo(socket, {
        type: 'error',
        reason: 'rate_limited',
        message: 'Slow down a moment before sending again.',
      });
      return null;
    }

    let parsed;
    try {
      parsed = JSON.parse(rawPayload.toString());
    } catch (err) {
      this.logger.warn?.({ err }, 'Invalid broadcast string dropped');
      return null;
    }

    const msg = sanitiseText(parsed?.msg, MAX_MESSAGE_LENGTH);
    if (!msg) return null;

    const message = {
      id: this.nextId++,
      user: sanitiseText(parsed?.user, MAX_USERNAME_LENGTH) || 'AnonymousPunter',
      msg,
      tag: sanitiseText(parsed?.tag, MAX_TAG_LENGTH) || null,
      time: formatTime(),
    };

    this.remember(message);
    this.broadcast({ type: 'message', message });
    return message;
  }

  isRateLimited(state) {
    const now = Date.now();
    state.timestamps = state.timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    if (state.timestamps.length >= RATE_LIMIT_MAX_MESSAGES) return true;
    state.timestamps.push(now);
    return false;
  }

  remember(message) {
    this.history.push(message);
    if (this.history.length > HISTORY_LIMIT) {
      this.history = this.history.slice(-HISTORY_LIMIT);
    }
  }

  broadcast(payload) {
    const encoded = JSON.stringify(payload);
    for (const socket of this.clients.keys()) {
      if (socket.readyState === 1) socket.send(encoded);
    }
  }

  broadcastPresence() {
    this.broadcast({ type: 'presence', online: this.size });
  }

  sendTo(socket, payload) {
    if (socket.readyState === 1) socket.send(JSON.stringify(payload));
  }

  /** Terminates sockets that missed the previous ping so presence stays honest. */
  reapStaleSockets() {
    for (const [socket, state] of this.clients) {
      if (!state.alive) {
        socket.terminate?.();
        this.remove(socket);
        continue;
      }
      state.alive = false;
      socket.ping?.();
    }
  }
}

module.exports = {
  PunterLounge,
  sanitiseText,
  formatTime,
  MAX_MESSAGE_LENGTH,
  RATE_LIMIT_MAX_MESSAGES,
  RATE_LIMIT_WINDOW_MS,
};
