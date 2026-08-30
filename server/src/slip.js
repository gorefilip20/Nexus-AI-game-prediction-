'use strict';

/**
 * Structured slip references.
 *
 * A real sportsbook booking code is minted by that sportsbook's own system from
 * its internal market ids — it cannot be computed client-side, and a
 * convincing-looking imitation would simply fail (or worse, load something
 * unintended) when pasted in. So this encodes the selection itself in a
 * documented, parseable format that round-trips back to the same fixture and
 * market. It identifies a pick unambiguously without pretending to be a
 * credential from a book this app is not connected to.
 *
 * Format:  NB1-<SPORT>-<FIXTURE_ID>-<MARKET>-<SELECTION>[-<LINE>]-<CHECK>
 * Example: NB1-FB-239625-1X2-H-7C
 */

const SPORT_CODES = { football: 'FB', basketball: 'BK', volleyball: 'VB' };
const SPORT_BY_CODE = Object.fromEntries(
  Object.entries(SPORT_CODES).map(([name, code]) => [code, name]),
);

const SELECTION_CODES = { Home: 'H', Draw: 'D', Away: 'A' };
const SELECTION_BY_CODE = { H: 'Home', D: 'Draw', A: 'Away' };

const PREFIX = 'NB1';

/** Two-character checksum so a truncated or mistyped code fails loudly. */
function checksum(body) {
  let hash = 0;
  for (let i = 0; i < body.length; i += 1) {
    hash = (hash * 31 + body.charCodeAt(i)) >>> 0;
  }
  return (hash % 256).toString(16).toUpperCase().padStart(2, '0');
}

function encodeLine(line) {
  if (line === null || line === undefined) return null;
  // '.' and '-' would collide with the separator, so encode them.
  return String(line).replace('-', 'M').replace('.', 'P');
}

function decodeLine(token) {
  if (!token) return null;
  const value = Number.parseFloat(token.replace('M', '-').replace('P', '.'));
  return Number.isFinite(value) ? value : null;
}

/**
 * Builds a slip code for a fixture.
 * Prefers the model's own strongest call, falling back to the market favourite.
 */
function encodeSlip(slip, model = null) {
  if (!slip?.id || !slip?.sport) return null;

  const sportCode = SPORT_CODES[slip.sport];
  if (!sportCode) return null;

  let market = '1X2';
  let selection = slip.pickLabel ?? null;
  let line = null;

  if (model?.outcome) {
    const { home, draw, away } = model.outcome;
    const best = [
      { label: 'Home', value: home ?? 0 },
      { label: 'Draw', value: draw ?? 0 },
      { label: 'Away', value: away ?? 0 },
    ].sort((a, b) => b.value - a.value)[0];
    selection = best.label;
  }

  if (!selection) return null;

  const selectionCode = SELECTION_CODES[selection];
  if (!selectionCode) return null;

  const parts = [PREFIX, sportCode, slip.id, market, selectionCode];
  const encodedLine = encodeLine(line);
  if (encodedLine) parts.push(encodedLine);

  const body = parts.join('-');
  return `${body}-${checksum(body)}`;
}

/**
 * Parses a slip code back into its selection.
 * @returns {{valid: boolean, reason?: string, sport?: string, fixtureId?: number}}
 */
function decodeSlip(code) {
  if (typeof code !== 'string' || !code.startsWith(`${PREFIX}-`)) {
    return { valid: false, reason: 'not a NexusBet slip code' };
  }

  const parts = code.trim().split('-');
  if (parts.length < 6) return { valid: false, reason: 'malformed slip code' };

  const provided = parts.pop();
  const body = parts.join('-');
  if (checksum(body) !== provided) {
    return { valid: false, reason: 'checksum mismatch — the code was altered or truncated' };
  }

  const [, sportCode, fixtureId, market, selectionCode, lineToken] = parts;
  const sport = SPORT_BY_CODE[sportCode];
  if (!sport) return { valid: false, reason: `unknown sport code ${sportCode}` };

  const selection = SELECTION_BY_CODE[selectionCode];
  if (!selection) return { valid: false, reason: `unknown selection code ${selectionCode}` };

  return {
    valid: true,
    sport,
    fixtureId: Number.parseInt(fixtureId, 10),
    market,
    selection,
    line: decodeLine(lineToken),
  };
}

module.exports = { encodeSlip, decodeSlip, checksum, SPORT_CODES, PREFIX };
