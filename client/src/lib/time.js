/**
 * Kickoff times arrive from the provider as UTC-anchored ISO strings and are
 * rendered in the reader's own timezone. That is the right behaviour, but it is
 * only safe if the page says so: a bare "15:00" is ambiguous, and on a board
 * whose whole purpose is telling you when a match starts, an ambiguous time is
 * a missed match.
 */

/** Short timezone name for the reader's locale, e.g. "WAT", "GMT+1", "EDT". */
export function localTimeZoneLabel(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat([], { timeZoneName: 'short' }).formatToParts(date);
    const zone = parts.find((part) => part.type === 'timeZoneName');
    if (zone?.value) return zone.value;
  } catch {
    // Intl exists everywhere this app runs, but never let a label break the board.
  }
  return null;
}

/** IANA zone, e.g. "Africa/Lagos" — the tooltip behind the short label. */
export function localTimeZoneName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}
