import { useEffect, useState } from 'react';
import { Archive } from 'lucide-react';

/** "2h 15m" — a countdown a reader can act on without doing arithmetic. */
function formatDuration(ms) {
  if (ms === null || ms === undefined || ms < 0) return null;
  const totalMinutes = Math.floor(ms / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m`;
  return 'under a minute';
}

function formatAge(seconds) {
  if (seconds === null || seconds === undefined) return null;
  if (seconds < 90) return 'moments ago';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${String(minutes % 60).padStart(2, '0')}m ago`;
}

/**
 * Shown when the board came from the continuity buffer rather than a live
 * fetch, so a user is never quietly reading yesterday's analysis as if it were
 * current. States how old it is and when live updates resume.
 */
export default function CachedDataBanner({ stale, staleReason, ageSeconds, liveUpdatesResumeAt, className = '' }) {
  const [remaining, setRemaining] = useState(null);

  useEffect(() => {
    if (!stale || !liveUpdatesResumeAt) return undefined;

    const tick = () => setRemaining(new Date(liveUpdatesResumeAt).getTime() - Date.now());
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [stale, liveUpdatesResumeAt]);

  if (!stale) return null;

  const age = formatAge(ageSeconds);
  const countdown = formatDuration(remaining);

  return (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-xl border border-blue-400/30 bg-blue-400/10 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3 ${className}`}
    >
      <Archive className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" />
      <p className="min-w-0 text-[11px] leading-relaxed text-blue-100/90 sm:text-xs">
        <span className="font-bold text-blue-200">Showing saved analysis.</span>{' '}
        {staleReason ?? 'Live data is temporarily unavailable.'}
        {age ? ` Last refreshed ${age}.` : ''}
        {countdown ? ` Live updates resume in about ${countdown}.` : ''}
      </p>
    </div>
  );
}
