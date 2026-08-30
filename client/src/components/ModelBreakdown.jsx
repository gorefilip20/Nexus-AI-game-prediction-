import { useState } from 'react';
import { ChevronDown, TriangleAlert } from 'lucide-react';

const MODEL_LABELS = {
  poisson: 'Poisson regression on goals',
  'normal-regression': 'Least-squares regression on points',
  'logistic-sets': 'Logistic regression on sets',
};

function OutcomeBar({ label, value, tone }) {
  return (
    <div>
      <div className="mb-1 flex justify-between text-[10px] font-bold uppercase tracking-wider">
        <span className="text-[#8a96a3]">{label}</span>
        <span className={tone}>{value === null ? 'n/a' : `${value}%`}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#0f212e]">
        <div
          className={`h-full rounded-full transition-[width] duration-700 ${
            tone === 'text-[#00e701]' ? 'bg-[#00e701]' : 'bg-[#4b7fa8]'
          }`}
          style={{ width: `${Math.min(Math.max(value ?? 0, 0), 100)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Shows what the model computed, and on what.
 *
 * The training-sample size and the model family are part of the number: a
 * probability fitted on nine matches means something different from one fitted
 * on three hundred, so both are always on screen next to it.
 */
export default function ModelBreakdown({ model, homeName, awayName }) {
  const [expanded, setExpanded] = useState(false);

  if (!model) {
    return (
      <div className="mb-4 rounded-lg border border-[#213743] bg-[#0f212e] p-3">
        <span className="text-xs text-[#8a96a3]">
          No model output — not enough finished fixtures in this league to fit one.
        </span>
      </div>
    );
  }

  const topTotal = model.totals?.[Math.floor((model.totals.length - 1) / 2)] ?? null;

  return (
    <div className="mb-4 rounded-lg border border-[#213743] bg-[#0f212e] p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider text-[#8a96a3]">
          Model probability
        </span>
        <span className="text-[10px] text-[#8a96a3]">
          {model.expected.home}–{model.expected.away} {model.expected.unit}
        </span>
      </div>

      <div className="space-y-2">
        <OutcomeBar label={homeName} value={model.outcome.home} tone="text-[#00e701]" />
        {model.outcome.draw ? (
          <OutcomeBar label="Draw" value={model.outcome.draw} tone="text-[#b1b6c0]" />
        ) : null}
        <OutcomeBar label={awayName} value={model.outcome.away} tone="text-[#b1b6c0]" />
      </div>

      {!model.reliable ? (
        <div className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-300/90">
          <TriangleAlert className="mt-0.5 h-3 w-3 shrink-0" />
          <span>Provisional: fitted on only {model.trainedOn} matches.</span>
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="mt-2 flex min-h-[44px] w-full items-center justify-between py-2 text-[10px] font-bold uppercase tracking-wider text-[#8a96a3] transition hover:text-white"
        aria-expanded={expanded}
      >
        <span>{expanded ? 'Hide' : 'More'} markets</span>
        <ChevronDown className={`h-3 w-3 transition ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {expanded ? (
        <div className="mt-2 space-y-2 border-t border-[#213743] pt-2 text-[11px]">
          {model.totals?.map((total) => (
            <div key={`t-${total.line}`} className="flex justify-between text-[#b1b6c0]">
              <span className="text-[#8a96a3]">Over/Under {total.line}</span>
              <span>
                <span className="text-[#00e701]">{total.over}%</span> / {total.under}%
              </span>
            </div>
          ))}

          {model.handicaps?.map((handicap) => (
            <div key={`h-${handicap.handicap}`} className="flex justify-between text-[#b1b6c0]">
              <span className="text-[#8a96a3]">
                Handicap {handicap.handicap > 0 ? `+${handicap.handicap}` : handicap.handicap}
              </span>
              <span>
                <span className="text-[#00e701]">{handicap.home}%</span> / {handicap.away}%
              </span>
            </div>
          ))}

          {model.btts ? (
            <div className="flex justify-between text-[#b1b6c0]">
              <span className="text-[#8a96a3]">Both teams to score</span>
              <span>
                <span className="text-[#00e701]">{model.btts.yes}%</span> / {model.btts.no}%
              </span>
            </div>
          ) : null}

          {model.scorelines?.length ? (
            <div className="flex justify-between text-[#b1b6c0]">
              <span className="text-[#8a96a3]">Most likely score</span>
              <span>
                {model.scorelines[0].home}–{model.scorelines[0].away} (
                {model.scorelines[0].probability}%)
              </span>
            </div>
          ) : null}

          <p className="pt-1 text-[10px] leading-relaxed text-[#8a96a3]">
            {MODEL_LABELS[model.model] ?? model.model}, fitted on {model.trainedOn} finished
            matches from this league.
          </p>
        </div>
      ) : null}
    </div>
  );
}
