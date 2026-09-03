import { useState } from 'react';
import Banner from './Banner.jsx';

const SPORT_LABELS = { football: 'Football', basketball: 'Basketball', volleyball: 'Volleyball' };

function StatCell({ label, value, hint, accent }) {
  return (
    <div className="px-1 py-4 sm:px-4">
      <div className="mb-1 text-[10px] font-extrabold uppercase tracking-[.05em] text-nx-faint">
        {label}
      </div>
      <div
        className={`nx-num text-[28px] font-extrabold leading-none sm:text-[34px] ${
          accent ? 'text-nx-accent' : 'text-nx-text'
        }`}
      >
        {value}
      </div>
      {hint ? <div className="mt-1.5 text-[11px] text-nx-faint">{hint}</div> : null}
    </div>
  );
}

/** WIN is the only settlement state that earns the accent. */
function SettlementTag({ status }) {
  const isWin = status === 'WIN';
  return (
    <span
      className={`inline-block px-2 py-1 text-[10px] font-extrabold uppercase tracking-[.05em] ${
        isWin ? 'border border-nx-accent text-nx-accent' : 'border border-nx-div text-nx-muted'
      }`}
    >
      {status}
    </span>
  );
}

/**
 * The reasoning stored with the pick when it was made, so a settled result can
 * be read against the analysis that produced it rather than judged on outcome.
 */
function StoredJustification({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="mt-1 inline-flex min-h-[44px] items-center text-[10px] font-extrabold uppercase tracking-[.05em] text-nx-faint"
      >
        {open ? 'Hide reasoning' : 'Why this pick'}
      </button>
      {open ? (
        <pre className="mt-1 max-w-md whitespace-pre-wrap border border-nx-div p-2.5 font-sans text-[10px] leading-relaxed text-nx-muted">
          {text}
        </pre>
      ) : null}
    </>
  );
}

export default function TrackerPanel({ tracker, meta }) {
  const hasSettled = tracker.settledCount > 0;

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-[26px] font-extrabold leading-tight sm:text-[30px]">Tracker</h1>
        <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-nx-muted">
          Every pick this app surfaced, written down before kickoff and graded against the
          final score. No sports API can report a win rate — only picks actually made can.
        </p>
      </div>

      {meta.stale ? (
        <Banner tone="accent" title="Showing saved analysis." className="mb-5">
          {meta.staleReason ?? 'Live data is temporarily unavailable.'}
        </Banner>
      ) : null}

      <div className="grid grid-cols-1 divide-y divide-nx-div border-y-2 border-nx-div sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <StatCell
          label="Settled win rate"
          value={hasSettled ? `${tracker.winRate}%` : '—'}
          accent={hasSettled}
          hint={
            hasSettled
              ? `${tracker.wins}W / ${tracker.losses}L over ${tracker.settledCount} settled`
              : 'No settled picks yet'
          }
        />
        <StatCell
          label="Current streak"
          value={tracker.currentStreak}
          hint="Consecutive wins, most recent first"
        />
        <StatCell
          label="Awaiting settlement"
          value={tracker.pendingCount}
          hint={tracker.voidCount > 0 ? `${tracker.voidCount} void` : 'Graded when each fixture ends'}
        />
      </div>

      {tracker.rows.length === 0 ? (
        <div className="mt-6 border border-nx-div px-4 py-5">
          <h2 className="mb-1.5 text-[15px] font-bold">No picks recorded yet</h2>
          <p className="text-[12px] leading-relaxed text-nx-muted">
            Open the board to load today&apos;s fixtures — every priced fixture is written here
            automatically, then graded once it finishes. The win rate stays blank until
            something actually settles.
          </p>
        </div>
      ) : (
        <div className="nx-scroll mt-6 overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left">
            <thead>
              <tr className="border-b-2 border-nx-div text-[10px] uppercase tracking-[.05em] text-nx-faint">
                <th scope="col" className="py-2.5 pr-3 font-extrabold">Fixture / league</th>
                <th scope="col" className="py-2.5 pr-3 font-extrabold">Recorded pick</th>
                <th scope="col" className="py-2.5 pr-3 font-extrabold">Price</th>
                <th scope="col" className="py-2.5 font-extrabold">Settlement</th>
              </tr>
            </thead>
            <tbody>
              {tracker.rows.map((row) => (
                <tr key={row.key} className="border-b border-nx-div align-top text-[12px]">
                  <td className="py-3 pr-3">
                    <span className="block font-bold text-nx-text">{row.match}</span>
                    <span className="text-[11px] text-nx-faint">
                      {SPORT_LABELS[row.sport] ?? row.sport} · {row.league ?? 'Unknown league'}
                    </span>
                    {row.result ? (
                      <span className="nx-num mt-0.5 block text-[11px] text-nx-faint">
                        Final {row.result.homeScore}–{row.result.awayScore}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-3 pr-3">
                    <span className="font-semibold text-nx-muted">{row.prediction}</span>
                    {row.probability ? (
                      <span className="nx-num mt-0.5 block text-[11px] text-nx-faint">
                        {row.probability}% implied at time of pick
                      </span>
                    ) : null}
                    <StoredJustification text={row.justification} />
                  </td>
                  <td className="nx-num py-3 pr-3">
                    <span className="font-bold">{row.odd ?? '—'}</span>
                    {row.bookmaker ? (
                      <span className="mt-0.5 block text-[11px] text-nx-faint">{row.bookmaker}</span>
                    ) : null}
                  </td>
                  <td className="py-3">
                    <SettlementTag status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
