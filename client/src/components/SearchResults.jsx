import { RefreshCw, SearchX, TriangleAlert } from 'lucide-react';
import PredictionCard from './PredictionCard.jsx';

/**
 * Results for a global fixture search.
 *
 * An empty result reports what was actually scanned, so "nothing found" is
 * distinguishable from "the feed was down" — the two call for different actions.
 */
export default function SearchResults({ query, state, response, error, onClear }) {
  if (state === 'searching' && !response) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-[#213743] bg-[#1a2c38] p-6 text-sm text-[#8a96a3]">
        <RefreshCw className="h-4 w-4 animate-spin text-[#00e701]" />
        Searching schedules for “{query}”…
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-6">
        <h2 className="mb-1 font-extrabold text-white">Search failed</h2>
        <p className="text-sm text-red-200/80">{error}</p>
      </div>
    );
  }

  if (!response) return null;

  const { results, scanned, matched, truncated, errors, daysScanned } = response;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-extrabold text-white">
          Results for “{response.query}”
        </h1>
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-bold uppercase tracking-wider text-[#8a96a3] transition hover:text-white"
        >
          Back to today's board
        </button>
      </div>

      <p className="text-sm text-[#8a96a3]">
        Scanned {scanned} scheduled fixture{scanned === 1 ? '' : 's'} across{' '}
        {daysScanned} day{daysScanned === 1 ? '' : 's'}
        {response.sport ? ` in ${response.sport}` : ''}. Matched {matched}.
        {truncated ? ` Showing the first ${results.length} by kickoff.` : ''}
      </p>

      {errors?.length ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-2">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <p className="text-[11px] leading-relaxed text-amber-200/80">
            Some schedules were unavailable:{' '}
            {errors.map((e) => `${e.sport} ${e.date}`).join(', ')}. Results may be incomplete.
          </p>
        </div>
      ) : null}

      {results.length === 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-[#213743] bg-[#1a2c38] p-6">
          <SearchX className="mt-0.5 h-5 w-5 shrink-0 text-[#8a96a3]" />
          <div>
            <h2 className="mb-1 font-bold text-white">No scheduled fixture matched</h2>
            <p className="text-sm text-[#8a96a3]">
              Nothing matching “{response.query}” is scheduled in the next {daysScanned} day
              {daysScanned === 1 ? '' : 's'}. Try widening the date range, clearing the sport
              filter, or checking the spelling. The engine will not price a match that is not
              being played.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {results.map((slip) => (
            <PredictionCard key={`${slip.sport}:${slip.id}`} slip={slip} />
          ))}
        </div>
      )}
    </div>
  );
}
