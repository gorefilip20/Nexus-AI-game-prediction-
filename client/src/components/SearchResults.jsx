import LeagueGroup from './LeagueGroup.jsx';

/** Groups results by competition, exactly as the board does. */
function groupByLeague(slips) {
  const groups = new Map();

  for (const slip of slips) {
    const key = `${slip.sport}:${slip.leagueId ?? slip.league ?? 'unknown'}`;
    if (!groups.has(key)) {
      groups.set(key, { key, league: slip.league, sport: slip.sport, fixtures: [] });
    }
    groups.get(key).fixtures.push(slip);
  }

  return [...groups.values()];
}

export default function SearchResults({ query, state, response, error }) {
  if (state === 'searching' && !response) {
    return (
      <div className="flex items-center gap-2.5 py-2">
        <span className="nx-live-dot h-[7px] w-[7px] shrink-0 bg-nx-accent" />
        <p className="text-[13px] text-nx-muted">Searching schedules for “{query}”…</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="border-2 border-nx-accent px-4 py-4">
        <h2 className="mb-1.5 text-[15px] font-bold">Search failed</h2>
        <p className="text-[12px] leading-relaxed text-nx-muted">
          {error ?? 'The search endpoint did not respond. Try again in a moment.'}
        </p>
      </div>
    );
  }

  if (!response) return null;

  const { results, scanned, matched, truncated, errors, daysScanned } = response;
  const groups = groupByLeague(results);

  return (
    <div>
      <h1 className="text-[24px] font-extrabold leading-tight sm:text-[28px]">
        Results for “{response.query}”
      </h1>

      <p className="mt-2 text-[12px] leading-relaxed text-nx-muted">
        Scanned <span className="nx-num">{scanned}</span> scheduled fixture
        {scanned === 1 ? '' : 's'} across <span className="nx-num">{daysScanned}</span> day
        {daysScanned === 1 ? '' : 's'}
        {response.sport ? ` in ${response.sport}` : ''}. Matched{' '}
        <span className="nx-num">{matched}</span>.
        {truncated ? ` Showing the first ${results.length} by kickoff.` : ''}
      </p>

      {errors?.length ? (
        <p className="mt-3 text-[11px] leading-relaxed text-nx-accent-hi">
          Some schedules were unavailable: {errors.map((e) => `${e.sport} ${e.date}`).join(', ')}.
          Results may be incomplete.
        </p>
      ) : null}

      {results.length === 0 ? (
        <div className="mt-5 border border-nx-div px-4 py-5">
          <h2 className="mb-1.5 text-[15px] font-bold">No scheduled fixture matched</h2>
          <p className="text-[12px] leading-relaxed text-nx-muted">
            Nothing matching “{response.query}” is scheduled in the next {daysScanned} day
            {daysScanned === 1 ? '' : 's'}. Try widening the date range, clearing the sport
            filter, or checking the spelling. The engine will not price a match that is not
            being played.
          </p>
        </div>
      ) : (
        <div className="mt-5">
          {groups.map((group) => (
            <LeagueGroup
              key={group.key}
              league={group.league}
              sport={group.sport}
              fixtures={group.fixtures}
            />
          ))}
        </div>
      )}
    </div>
  );
}
