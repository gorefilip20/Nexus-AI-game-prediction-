'use strict';

const { predictions } = require('../data');

/**
 * Offline stand-in used when no provider key is configured, so the dashboard
 * still runs for UI work. Everything it returns is flagged `live: false` and
 * `sampleData: true` so the client can label it on screen.
 */
function createSampleProvider({ now = () => new Date() } = {}) {
  return {
    name: 'sample',
    live: false,
    sports: ['football', 'basketball', 'volleyball'],

    async getSlips() {
      return {
        provider: 'sample',
        live: false,
        sampleData: true,
        fetchedAt: now().toISOString(),
        quota: {},
        degraded: [
          { sport: 'all', error: 'No API_SPORTS_KEY configured — serving sample fixtures' },
        ],
        slips: predictions.map((item) => ({
          sport: item.sport.toLowerCase(),
          id: item.id,
          ref: item.code,
          league: item.league,
          country: null,
          season: null,
          round: null,
          home: item.match.split(' vs ')[0] ?? null,
          away: item.match.split(' vs ')[1] ?? null,
          kickoff: null,
          timestamp: null,
          status: { short: 'NS', long: 'Not Started', finished: false, notStarted: true },
          homeScore: null,
          awayScore: null,
          prediction: item.prediction,
          pickLabel: 'Home',
          probability: item.prob,
          odd: null,
          bookmaker: null,
          market: 'Sample',
          overround: null,
          oddsAvailable: false,
          source: 'sample',
        })),
      };
    },

    async getResults() {
      return new Map();
    },

    getQuota: () => ({}),
  };
}

module.exports = { createSampleProvider };
