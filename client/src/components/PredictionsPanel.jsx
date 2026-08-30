import { useCallback, useEffect, useState } from 'react';
import { Copy } from 'lucide-react';
import DataProvenanceNotice from './DataProvenanceNotice.jsx';
import ModelBreakdown from './ModelBreakdown.jsx';

const SPORT_LABELS = { football: 'Football', basketball: 'Basketball', volleyball: 'Volleyball' };

function formatKickoff(kickoff) {
  if (!kickoff) return null;
  const date = new Date(kickoff);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], {
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
  });
}

function ProbabilityBar({ value }) {
  return (
    <div className="mb-4">
      <div className="mb-1 flex justify-between text-[10px] font-bold uppercase tracking-wider text-[#8a96a3]">
        <span>Market Implied</span>
        <span className="text-[#00e701]">{value}%</span>
      </div>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[#0f212e]"
        role="progressbar"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-[#00e701] transition-[width] duration-700"
          style={{ width: `${Math.min(Math.max(value, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

function PredictionCard({ slip, copiedRef, onCopy }) {
  const isCopied = copiedRef === (slip.slipCode ?? slip.ref);
  const kickoff = formatKickoff(slip.kickoff);

  return (
    <div className="group relative overflow-hidden rounded-xl border border-[#213743] bg-[#1a2c38] p-5 transition hover:border-[#2f4553]">
      {slip.oddsAvailable ? (
        <div className="absolute right-0 top-0 rounded-bl-lg border-b border-l border-[#00e701]/20 bg-[#00e701]/10 px-3 py-1 text-xs font-bold text-[#00e701]">
          {slip.probability}% Implied
        </div>
      ) : (
        <div className="absolute right-0 top-0 rounded-bl-lg border-b border-l border-[#2f4553] bg-[#213743] px-3 py-1 text-xs font-bold text-[#8a96a3]">
          Unpriced
        </div>
      )}

      <div className="mb-1 text-xs font-bold uppercase tracking-wider text-[#8a96a3]">
        {SPORT_LABELS[slip.sport] ?? slip.sport} • {slip.league ?? 'Unknown league'}
      </div>
      <h3 className="mb-1 pr-24 text-lg font-bold text-white">
        {slip.home} vs {slip.away}
      </h3>
      {kickoff ? <p className="mb-3 text-xs text-[#8a96a3]">{kickoff}</p> : <div className="mb-3" />}

      <div className="mb-4 rounded-lg border border-[#213743] bg-[#0f212e] p-3">
        {slip.oddsAvailable ? (
          <>
            <span className="mb-1 block text-xs text-[#8a96a3]">
              Market favourite ({slip.bookmaker}):
            </span>
            <span className="text-md font-black text-white">{slip.prediction}</span>
            <span className="mt-1 block text-xs text-[#8a96a3]">
              Best price <span className="font-mono text-[#00e701]">{slip.odd}</span>
            </span>
          </>
        ) : (
          <>
            <span className="mb-1 block text-xs text-[#8a96a3]">No market odds available</span>
            <span className="text-sm text-[#b1b6c0]">
              This fixture is real, but the provider returned no priced market for it.
            </span>
          </>
        )}
      </div>

      {slip.oddsAvailable ? <ProbabilityBar value={slip.probability} /> : null}

      <ModelBreakdown model={slip.model} homeName={slip.home} awayName={slip.away} />

      <div className="flex items-center justify-between rounded-lg bg-[#213743] p-3">
        <div>
          <span className="block text-[10px] font-bold uppercase text-[#8a96a3]">
            NexusBet Slip Code
          </span>
          <code className="font-mono text-sm font-bold text-[#00e701]">
            {slip.slipCode ?? slip.ref}
          </code>
        </div>
        <button
          type="button"
          onClick={() => onCopy(slip.slipCode ?? slip.ref)}
          className="flex items-center space-x-1 rounded-md bg-[#00e701] p-2 text-xs font-black text-black transition hover:bg-[#00c900]"
        >
          <Copy className="h-3.5 w-3.5" />
          <span>{isCopied ? 'Copied!' : 'Copy'}</span>
        </button>
      </div>
    </div>
  );
}

export default function PredictionsPanel({ predictions, meta }) {
  const [copiedRef, setCopiedRef] = useState(null);

  const handleCopy = useCallback(async (reference) => {
    try {
      await navigator.clipboard.writeText(reference);
    } catch {
      // Clipboard access can be blocked (insecure origin, denied permission);
      // still flag the click so the button does not look dead.
    }
    setCopiedRef(reference);
  }, []);

  useEffect(() => {
    if (!copiedRef) return undefined;
    const timer = setTimeout(() => setCopiedRef(null), 2000);
    return () => clearTimeout(timer);
  }, [copiedRef]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-white">Live Sports Predictive Slips</h1>
        <p className="text-sm text-[#8a96a3]">
          Upcoming football, basketball and volleyball fixtures, priced from live bookmaker
          markets.
        </p>
      </div>

      <DataProvenanceNotice
        live={meta.live}
        provider={meta.provider}
        fetchedAt={meta.fetchedAt}
        degraded={meta.degraded}
        className="mb-6"
      />

      <p className="mb-4 text-[11px] leading-relaxed text-[#8a96a3]">
        Slip codes are NexusBet references that decode back to the exact fixture and
        selection. They are not sportsbook booking codes and will not load a bet slip on
        Stake or elsewhere.
      </p>

      {predictions.length === 0 ? (
        <div className="rounded-xl border border-[#213743] bg-[#1a2c38] p-6 text-sm text-[#8a96a3]">
          No fixtures returned for today. This is normal out of season, or when the daily API
          quota is spent.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {predictions.map((slip) => (
            <PredictionCard
              key={`${slip.sport}:${slip.id}`}
              slip={slip}
              copiedRef={copiedRef}
              onCopy={handleCopy}
            />
          ))}
        </div>
      )}
    </div>
  );
}
