import { useMemo, useState } from 'react';
import Banner from './Banner.jsx';
import { localTimeZoneLabel, localTimeZoneName } from '../lib/time.js';
import LeagueGroup from './LeagueGroup.jsx';

const SPORT_FILTERS = [
  { value: '', label: 'All sports' },
  { value: 'football', label: 'Football' },
  { value: 'basketball', label: 'Basketball' },
  { value: 'volleyball', label: 'Volleyball' },
];

/** "2h 15m" — a countdown the reader can act on without arithmetic. */
function formatDuration(target) {
  if (!target) return null;
  const ms = new Date(target).getTime() - Date.now();
  if (!Number.isFinite(ms) || ms < 0) return null;

  const minutes = Math.floor(ms / 60_000);
  const hours = Math.floor(minutes / 60);
  if (hours > 0) return `${hours}h ${String(minutes % 60).padStart(2, '0')}m`;
  return minutes > 0 ? `${minutes}m` : 'under a minute';
}

function formatAge(seconds) {
  if (seconds === null || seconds === undefined) return null;
  if (seconds < 90) return 'moments ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m ago`;
}

function SkeletonRow() {
  return (
    <div className="grid grid-cols-[58px_1fr_auto] items-center gap-2 border-t border-nx-div py-3.5">
      <div className="h-3 w-full bg-nx-surface-2" />
      <div className="h-3 w-3/5 bg-nx-surface-2" />
      <div className="h-3 w-10 bg-nx-surface-2" />
    </div>
  );
}

/** Groups fixtures by competition, ordered by earliest kickoff in each. */
function groupByLeague(slips) {
  const groups = new Map();

  for (const slip of slips) {
    const key = `${slip.sport}:${slip.leagueId ?? slip.league ?? 'unknown'}`;
    if (!groups.has(key)) {
      groups.set(key, { key, league: slip.league, sport: slip.sport, fixtures: [] });
    }
    groups.get(key).fixtures.push(slip);
  }

  for (const group of groups.values()) {
    group.fixtures.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
    group.earliest = group.fixtures[0]?.timestamp ?? 0;
  }

  return [...groups.values()].sort((a, b) => a.earliest - b.earliest);
}

export default function PredictionsPanel({ predictions, meta, state, error, onRetry }) {
  const [sportFilter, setSportFilter] = useState('');

  const filtered = useMemo(
    () => (sportFilter ? predictions.filter((s) => s.sport === sportFilter) : predictions),
    [predictions, sportFilter],
  );

  const groups = useMemo(() => groupByLeague(filtered), [filtered]);
  const highConfidence = filtered.filter((s) => s.highConfidence).length;

  const zoneLabel = localTimeZoneLabel();
  const zoneName = localTimeZoneName();

  const header = (
    <div className="mb-5">
      <h1 className="text-[26px] font-extrabold leading-tight sm:text-[30px]">The board</h1>
      <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-nx-muted">
        Upcoming football, basketball and volleyball fixtures, priced from live bookmaker
        markets and analysed against a fitted model. Grouped by competition — the tie that
        matters is bigger than the one that doesn&apos;t.
      </p>
      {zoneLabel ? (
        <p className="mt-2 text-[11px] uppercase tracking-[.05em] text-nx-faint" title={zoneName ?? undefined}>
          All kick-off times in your local time ({zoneLabel})
        </p>
      ) : null}
    </div>
  );

  if (state === 'loading') {
    return (
      <div>
        {header}
        <div className="border-t-2 border-nx-div pt-1">
          {Array.from({ length: 6 }, (_, i) => (
            <SkeletonRow key={i} />
          ))}
        </div>
        <p className="mt-4 text-[12px] text-nx-faint">Loading today&apos;s fixtures…</p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div>
        {header}
        <div className="border-2 border-nx-accent px-4 py-4">
          <h2 className="mb-1.5 text-[15px] font-bold">Engine unreachable</h2>
          <p className="mb-4 text-[12px] leading-relaxed text-nx-muted">
            {error ?? 'The prediction engine did not respond.'} Nothing is shown rather than
            anything invented.
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="min-h-[44px] bg-nx-accent px-4 text-[12px] font-extrabold uppercase tracking-[.05em] text-nx-bg"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // At most one banner: the reader should see the state that matters, not a stack.
  const banner = meta.stale ? (
    <Banner tone="accent" title="Showing saved analysis." className="mb-4">
      {meta.staleReason ?? 'Live data is temporarily unavailable.'}
      {formatAge(meta.ageSeconds) ? ` Last refreshed ${formatAge(meta.ageSeconds)}.` : ''}
      {formatDuration(meta.liveUpdatesResumeAt)
        ? ` Live updates resume in about ${formatDuration(meta.liveUpdatesResumeAt)}.`
        : ''}
    </Banner>
  ) : !meta.live ? (
    <Banner tone="accent" title="Sample data." className="mb-4">
      No sports API key is configured, so these fixtures and odds are demo content — not live
      data and not a record of settled wagers.
    </Banner>
  ) : (
    <Banner title={`Live via ${meta.provider}.`} className="mb-4">
      Each percentage is the bookmaker&apos;s price with its margin removed — the market&apos;s
      view, not a proprietary forecast. Betting risks real money; no pick predicts a result.
    </Banner>
  );

  return (
    <div>
      {header}
      {banner}

      {meta.degraded?.length ? (
        <p className="mb-4 text-[11px] leading-relaxed text-nx-accent-hi">
          {meta.degraded.map((d) => `${d.sport}: ${d.error}`).join(' · ')}
        </p>
      ) : null}

      {highConfidence > 0 ? (
        <p className="mb-4 text-[12px] leading-relaxed text-nx-muted">
          <span className="nx-num font-bold text-nx-text">{highConfidence}</span> of{' '}
          <span className="nx-num">{filtered.length}</span> fixtures clear the confidence
          threshold. A higher threshold raises the strike rate and shrinks the board — it does
          not make a pick profitable.
        </p>
      ) : null}

      <div className="mb-5 flex flex-wrap gap-2">
        {SPORT_FILTERS.map((option) => {
          const active = sportFilter === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => setSportFilter(option.value)}
              aria-pressed={active}
              className={`min-h-[44px] px-3.5 text-[12px] font-bold ${
                active
                  ? 'bg-nx-text text-nx-bg'
                  : 'border border-nx-div text-nx-muted'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {groups.length === 0 ? (
        <div className="border border-nx-div px-4 py-5">
          <h2 className="mb-1.5 text-[15px] font-bold">No fixtures today</h2>
          <p className="text-[12px] leading-relaxed text-nx-muted">
            {sportFilter
              ? 'Nothing scheduled in this sport for the current window. Try All sports.'
              : 'The provider returned no fixtures for the coverage window. This is normal out of season, or when the daily request budget is spent.'}
          </p>
        </div>
      ) : (
        <div>
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

      <p className="mt-6 border-t border-nx-div pt-4 text-[11px] leading-relaxed text-nx-faint">
        Slip codes are NexusBet references that decode back to the exact fixture and selection.
        They are not sportsbook booking codes and will not load a bet slip on Stake or
        elsewhere.
      </p>
    </div>
  );
}
