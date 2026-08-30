import { Radio, TriangleAlert } from 'lucide-react';

/**
 * States plainly where the numbers on screen came from.
 *
 * Live probabilities are devigged bookmaker odds — the betting market's view,
 * not a proprietary model — and saying so is the difference between reporting a
 * number and implying a track record the app cannot evidence.
 */
export default function DataProvenanceNotice({ live, provider, fetchedAt, degraded = [], className = '' }) {
  const stamp = fetchedAt ? new Date(fetchedAt).toLocaleTimeString() : null;

  return (
    <div className={`space-y-2 ${className}`}>
      {live ? (
        <div className="flex items-start gap-3 rounded-xl border border-[#00e701]/25 bg-[#00e701]/5 px-4 py-3">
          <Radio className="mt-0.5 h-4 w-4 shrink-0 animate-pulse text-[#00e701]" />
          <p className="text-xs leading-relaxed text-[#b1b6c0]">
            <span className="font-bold text-[#00e701]">Live data via {provider}.</span> Fixtures
            and odds are real. Each percentage is the bookmaker's price with its margin
            removed — the market's implied probability, not a proprietary model's forecast.
            {stamp ? ` Refreshed ${stamp}.` : ''} Betting risks real money; no pick is a
            prediction of the result.
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
          <p className="text-xs leading-relaxed text-amber-200/90">
            <span className="font-bold text-amber-300">Sample data.</span> No sports API key is
            configured, so these fixtures, odds and results are demo content — not live data and
            not a record of settled wagers. Set <code className="font-mono">API_SPORTS_KEY</code>{' '}
            to serve real fixtures.
          </p>
        </div>
      )}

      {degraded.length > 0 ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/25 bg-amber-500/5 px-4 py-2">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-400" />
          <p className="text-[11px] leading-relaxed text-amber-200/80">
            {degraded.map((d) => `${d.sport}: ${d.error}`).join(' · ')}
          </p>
        </div>
      ) : null}
    </div>
  );
}
