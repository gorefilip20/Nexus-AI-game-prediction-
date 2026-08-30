import { useState } from 'react';
import { CheckCircle, Clock, Flame, ShieldCheck, TrendingUp, XCircle } from 'lucide-react';
import DataProvenanceNotice from './DataProvenanceNotice.jsx';

/**
 * The analysis stored with the pick when it was made.
 *
 * Shown against the settled result so a win or loss can be read back against
 * the reasoning that produced it, rather than judged on the outcome alone.
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
        className="mt-1 text-[10px] font-bold uppercase tracking-wider text-[#8a96a3] transition hover:text-white"
      >
        {open ? 'Hide reasoning' : 'Why this pick'}
      </button>
      {open ? (
        <pre className="mt-2 max-w-md whitespace-pre-wrap rounded-md border border-[#213743] bg-[#0f212e] p-2.5 font-sans text-[10px] leading-relaxed text-[#b1b6c0]">
          {text}
        </pre>
      ) : null}
    </>
  );
}

const SPORT_LABELS = { football: 'Football', basketball: 'Basketball', volleyball: 'Volleyball' };

function StatTile({ Icon, iconClass, valueClass, label, value, hint, withDivider }) {
  return (
    <div className={withDivider ? 'pr-4 md:border-r md:border-[#2f4553]/40' : ''}>
      <div className="mb-1 text-xs font-bold uppercase tracking-wider text-[#8a96a3]">{label}</div>
      <div
        className={`flex items-center justify-center space-x-2 text-4xl font-black md:justify-start ${valueClass}`}
      >
        <Icon className={`h-8 w-8 ${iconClass}`} />
        <span>{value}</span>
      </div>
      {hint ? <div className="mt-1 text-[11px] text-[#8a96a3]">{hint}</div> : null}
    </div>
  );
}

function SettlementBadge({ status }) {
  const config = {
    WIN: { Icon: CheckCircle, className: 'border-[#00e701]/20 bg-[#00e701]/10 text-[#00e701]' },
    LOSS: { Icon: XCircle, className: 'border-red-500/20 bg-red-500/10 text-red-400' },
    PENDING: { Icon: Clock, className: 'border-[#2f4553] bg-[#213743] text-[#8a96a3]' },
    VOID: { Icon: XCircle, className: 'border-[#2f4553] bg-[#213743] text-[#8a96a3]' },
  }[status] ?? { Icon: Clock, className: 'border-[#2f4553] bg-[#213743] text-[#8a96a3]' };

  const { Icon, className } = config;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-black ${className}`}
    >
      <Icon className="h-3.5 w-3.5" />
      {status}
    </span>
  );
}

export default function TrackerPanel({ tracker, meta }) {
  const hasSettled = tracker.settledCount > 0;

  return (
    <div className="space-y-6">
      <DataProvenanceNotice
        live={meta.live}
        provider={meta.provider}
        fetchedAt={meta.fetchedAt}
        degraded={meta.degraded}
      />

      <div className="grid grid-cols-1 gap-6 rounded-xl border border-[#2f4553] bg-gradient-to-r from-[#1a2c38] to-[#213743] p-6 text-center md:grid-cols-3 md:text-left">
        <StatTile
          Icon={ShieldCheck}
          iconClass="text-[#00e701]"
          valueClass={hasSettled ? 'text-[#00e701]' : 'text-[#8a96a3]'}
          label="Settled Win Rate"
          value={hasSettled ? `${tracker.winRate}%` : '—'}
          hint={
            hasSettled
              ? `${tracker.wins}W / ${tracker.losses}L over ${tracker.settledCount} settled`
              : 'No settled picks yet'
          }
          withDivider
        />
        <StatTile
          Icon={Flame}
          iconClass={tracker.currentStreak > 0 ? 'text-orange-500' : 'text-[#8a96a3]'}
          valueClass={tracker.currentStreak > 0 ? 'text-orange-500' : 'text-[#8a96a3]'}
          label="Current Win Streak"
          value={tracker.currentStreak}
          hint="Consecutive wins, most recent first"
          withDivider
        />
        <StatTile
          Icon={TrendingUp}
          iconClass="text-blue-400"
          valueClass="text-white"
          label="Awaiting Settlement"
          value={tracker.pendingCount}
          hint={tracker.voidCount > 0 ? `${tracker.voidCount} void` : 'Graded after each fixture ends'}
        />
      </div>

      <p className="text-xs leading-relaxed text-[#8a96a3]">
        {meta.live
          ? 'Every pick shown on the board is written to a ledger before kickoff and graded against the final score once the fixture finishes. No sports API can report a win rate, so this figure counts only picks this app actually made — it starts empty and fills in as fixtures settle.'
          : 'Sample rows. With a provider key configured, this table records each pick before kickoff and grades it against the real result.'}
      </p>

      <div className="overflow-hidden rounded-xl border border-[#213743] bg-[#1a2c38]">
        <div className="border-b border-[#213743] bg-[#213743]/30 px-6 py-4">
          <h2 className="text-lg font-extrabold text-white">Historic Multi-League Set Audit</h2>
        </div>

        {tracker.rows.length === 0 ? (
          <div className="p-6 text-sm text-[#8a96a3]">
            No picks recorded yet. Open the Predictions tab to load today's board — each priced
            fixture is written here automatically.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="border-b border-[#213743] bg-[#0f212e] text-xs font-bold uppercase text-[#8a96a3]">
                  <th scope="col" className="p-4">Fixture / League</th>
                  <th scope="col" className="p-4">Recorded Pick</th>
                  <th scope="col" className="p-4">Price</th>
                  <th scope="col" className="p-4 text-center">Settlement</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#213743]">
                {tracker.rows.map((row) => (
                  <tr key={row.key} className="text-sm transition hover:bg-[#213743]/20">
                    <td className="p-4">
                      <span className="block font-bold text-white">{row.match}</span>
                      <span className="text-xs text-[#8a96a3]">
                        {SPORT_LABELS[row.sport] ?? row.sport} • {row.league ?? 'Unknown league'}
                      </span>
                      {row.result ? (
                        <span className="mt-0.5 block font-mono text-xs text-[#8a96a3]">
                          Final {row.result.homeScore}-{row.result.awayScore}
                        </span>
                      ) : null}
                    </td>
                    <td className="p-4">
                      <span className="font-semibold text-[#e2e8f0]">{row.prediction}</span>
                      {row.probability ? (
                        <span className="mt-0.5 block text-xs text-[#8a96a3]">
                          {row.probability}% implied at time of pick
                        </span>
                      ) : null}
                      <StoredJustification text={row.justification} />
                    </td>
                    <td className="p-4">
                      <span className="font-mono text-[#00e701]">{row.odd ?? '—'}</span>
                      {row.bookmaker ? (
                        <span className="mt-0.5 block text-xs text-[#8a96a3]">{row.bookmaker}</span>
                      ) : null}
                    </td>
                    <td className="p-4 text-center">
                      <SettlementBadge status={row.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
