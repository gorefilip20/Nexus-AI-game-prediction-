import { useCallback, useEffect, useId, useState } from 'react';

const SPORT_LABELS = { football: 'Football', basketball: 'Basketball', volleyball: 'Volleyball' };

/** "Tue, 14:30, 12 Sep" — enough to place a fixture without a full date. */
function formatKickoff(kickoff) {
  if (!kickoff) return 'TBC';
  const date = new Date(kickoff);
  if (Number.isNaN(date.getTime())) return 'TBC';

  const weekday = date.toLocaleDateString([], { weekday: 'short' });
  const time = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  const day = date.toLocaleDateString([], { day: 'numeric', month: 'short' });
  return `${weekday} ${time}, ${day}`;
}

function ProbabilityBar({ label, value, accent }) {
  const width = Math.min(Math.max(value ?? 0, 0), 100);

  return (
    <div>
      <div className="mb-[3px] flex justify-between text-[11px]">
        <span className="truncate pr-2">{label}</span>
        <span className="nx-num shrink-0 font-bold">{value}%</span>
      </div>
      <div className="h-[4px] w-full bg-nx-surface-2">
        <div
          className={`h-full ${accent ? 'bg-nx-accent' : 'bg-nx-muted'}`}
          style={{ width: `${width}%` }}
        />
      </div>
    </div>
  );
}

/** The six-column value table, in its own scroller on narrow screens. */
function ValueTable({ value, homeName, awayName }) {
  const labels = { Home: homeName, Draw: 'Draw', Away: awayName };

  return (
    <div className="nx-scroll -mx-1 overflow-x-auto px-1">
      <table className="nx-num w-full min-w-[340px] border-collapse text-left text-[11px]">
        <thead>
          <tr className="border-b border-nx-div text-[10px] uppercase tracking-[.05em] text-nx-faint">
            <th scope="col" className="py-1.5 pr-3 font-bold">Outcome</th>
            <th scope="col" className="py-1.5 pr-3 font-bold">Price</th>
            <th scope="col" className="py-1.5 pr-3 font-bold">Model</th>
            <th scope="col" className="py-1.5 pr-3 font-bold">Market</th>
            <th scope="col" className="py-1.5 pr-3 font-bold">Gap</th>
            <th scope="col" className="py-1.5 font-bold">EV</th>
          </tr>
        </thead>
        <tbody>
          {value.outcomes.map((outcome) => (
            <tr key={outcome.label} className="border-b border-nx-div/60 text-nx-muted">
              <td className="py-1.5 pr-3 font-semibold text-nx-text">
                {labels[outcome.label] ?? outcome.label}
              </td>
              <td className="py-1.5 pr-3">{outcome.odd}</td>
              <td className="py-1.5 pr-3">{outcome.modelProbability}%</td>
              <td className="py-1.5 pr-3">
                {outcome.marketProbability === null ? '—' : `${outcome.marketProbability}%`}
              </td>
              <td className="py-1.5 pr-3">
                {outcome.gap === null ? '—' : `${outcome.gap > 0 ? '+' : ''}${outcome.gap}`}
              </td>
              <td
                className={`py-1.5 font-bold ${
                  outcome.expectedValue > 0 ? 'text-nx-accent' : 'text-nx-faint'
                }`}
              >
                {outcome.expectedValue > 0 ? '+' : ''}
                {outcome.expectedValue}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CATEGORY_ORDER = ['Model', 'Team form', 'Head-to-head', 'Expected value'];

function InsightAccordion({ insight, homeName, awayName }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();

  if (!insight) return null;

  const groups = CATEGORY_ORDER.map((category) => ({
    category,
    texts: (insight.bullets ?? []).filter((b) => b.category === category).map((b) => b.text),
  })).filter((group) => group.texts.length > 0);

  return (
    <div className="border border-nx-div">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-[44px] w-full items-center justify-between px-3 py-2.5 text-left"
      >
        <span className="text-[10px] font-extrabold uppercase tracking-[.05em] text-nx-faint">
          AI insight &amp; analysis
        </span>
        <span className="text-[12px] text-nx-faint">{open ? '−' : '+'}</span>
      </button>

      {open ? (
        <div id={panelId} className="space-y-3.5 border-t border-nx-div px-3 py-3">
          {groups.map((group) => (
            <div key={group.category}>
              <div className="mb-1.5 text-[10px] font-extrabold uppercase tracking-[.05em] text-nx-faint">
                {group.category}
              </div>
              <ul className="space-y-1.5">
                {group.texts.map((text) => (
                  <li key={text} className="text-[11px] leading-relaxed text-nx-muted">
                    {text}
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {insight.value ? (
            <ValueTable value={insight.value} homeName={homeName} awayName={awayName} />
          ) : null}

          {insight.caveats?.length ? (
            <ul className="space-y-1 border-t border-nx-div pt-2.5">
              {insight.caveats.map((caveat) => (
                <li key={caveat} className="text-[10px] leading-relaxed text-nx-accent-hi">
                  {caveat}
                </li>
              ))}
            </ul>
          ) : null}

          <p className="border-t border-nx-div pt-2.5 text-[10px] leading-relaxed text-nx-faint">
            Generated by a rule-based engine from the fitted model, this league&apos;s finished
            results and the live odds ladder. Not written by a language model, and not advice.
          </p>
        </div>
      ) : null}
    </div>
  );
}

function ModelCard({ model, homeName, awayName }) {
  const [showMarkets, setShowMarkets] = useState(false);

  return (
    <div className="border border-nx-div px-3.5 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="text-[10px] font-extrabold uppercase tracking-[.05em] text-nx-faint">
          Model probability
        </span>
        <span className="nx-num shrink-0 text-[11px] text-nx-faint">
          {model.expected.home}–{model.expected.away} {model.expected.unit}
        </span>
      </div>

      <div className="flex flex-col gap-1.5">
        <ProbabilityBar label={homeName} value={model.outcome.home} accent />
        {model.outcome.draw ? <ProbabilityBar label="Draw" value={model.outcome.draw} /> : null}
        <ProbabilityBar label={awayName} value={model.outcome.away} />
      </div>

      {!model.reliable ? (
        <p className="mt-2.5 text-[10px] leading-relaxed text-nx-accent-hi">
          Provisional: fitted on only {model.trainedOn} matches.
        </p>
      ) : null}

      <button
        type="button"
        onClick={() => setShowMarkets((v) => !v)}
        aria-expanded={showMarkets}
        className="mt-2 flex min-h-[44px] w-full items-center justify-between text-[10px] font-extrabold uppercase tracking-[.05em] text-nx-faint"
      >
        <span>{showMarkets ? 'Hide markets' : 'More markets'}</span>
        <span className="text-[12px]">{showMarkets ? '−' : '+'}</span>
      </button>

      {showMarkets ? (
        <div className="nx-num space-y-1 border-t border-nx-div pt-2 text-[11px] text-nx-muted">
          {model.totals?.map((total) => (
            <div key={`t-${total.line}`} className="flex justify-between">
              <span className="text-nx-faint">Over/Under {total.line}</span>
              <span>
                {total.over}% / {total.under}%
              </span>
            </div>
          ))}
          {model.handicaps?.map((handicap) => (
            <div key={`h-${handicap.handicap}`} className="flex justify-between">
              <span className="text-nx-faint">
                Handicap {handicap.handicap > 0 ? `+${handicap.handicap}` : handicap.handicap}
              </span>
              <span>
                {handicap.home}% / {handicap.away}%
              </span>
            </div>
          ))}
          {model.btts ? (
            <div className="flex justify-between">
              <span className="text-nx-faint">Both teams to score</span>
              <span>
                {model.btts.yes}% / {model.btts.no}%
              </span>
            </div>
          ) : null}
          <p className="pt-1 text-[10px] leading-relaxed text-nx-faint">
            {model.model}, fitted on {model.trainedOn} finished matches from this league.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * One fixture, as a dense row that expands in place.
 *
 * The board now carries hundreds of fixtures across dozens of competitions, so
 * the unit has to be scannable in a list rather than a card in a grid: kickoff,
 * teams, price and one probability on a single line, with everything else behind
 * a disclosure.
 */
export default function FixtureRow({ slip }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const panelId = useId();

  const reference = slip.slipCode ?? slip.ref;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(reference);
    } catch {
      // Clipboard access can be blocked (insecure origin, denied permission);
      // still confirm the click so the control does not look dead.
    }
    setCopied(true);
  }, [reference]);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <div className="border-t border-nx-div">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="grid min-h-[44px] w-full grid-cols-[58px_1fr_auto_auto_16px] items-center gap-2 px-1 py-3 text-left sm:grid-cols-[110px_1fr_auto_auto_18px] sm:gap-3"
      >
        <span className="nx-num overflow-hidden text-[11px] leading-tight text-nx-faint sm:whitespace-nowrap sm:text-[12px]">
          {formatKickoff(slip.kickoff)}
        </span>

        <span className="min-w-0 overflow-hidden">
          <span
            className={`block truncate text-[13px] sm:text-[14px] ${
              slip.highConfidence ? 'font-extrabold' : 'font-semibold'
            }`}
          >
            {slip.home} vs {slip.away}
          </span>
          {slip.highConfidence ? (
            <span className="block text-[10px] font-extrabold uppercase tracking-[.05em] text-nx-accent">
              High confidence · {slip.confidence}%
            </span>
          ) : null}
        </span>

        <span className="nx-num whitespace-nowrap text-[12px] font-bold sm:text-[13px]">
          {slip.oddsAvailable ? (
            slip.odd
          ) : (
            <span className="border border-nx-div px-1.5 py-[3px] text-[10px] font-bold text-nx-faint sm:text-[11px]">
              Unpriced
            </span>
          )}
        </span>

        <span className="nx-num whitespace-nowrap text-[11px] text-nx-muted sm:text-[12px]">
          {slip.oddsAvailable ? `${slip.probability}%` : ''}
        </span>

        <span className="text-right text-[12px] text-nx-faint">{expanded ? '−' : '+'}</span>
      </button>

      {expanded ? (
        <div id={panelId} className="flex flex-col gap-3.5 px-1 pb-4">
          <div className="text-[11px] text-nx-faint">
            {SPORT_LABELS[slip.sport] ?? slip.sport} · {slip.league ?? 'Unknown league'}
            {slip.oddsAvailable && slip.bookmaker ? ` · ${slip.bookmaker}` : ''}
          </div>

          {slip.oddsAvailable ? (
            <div className="text-[12px] text-nx-muted">
              Market favourite:{' '}
              <span className="font-semibold text-nx-text">{slip.prediction}</span>
            </div>
          ) : (
            <div className="border border-nx-div px-3 py-2.5 text-[12px] text-nx-muted">
              No market odds available. The fixture is real; the provider returned no priced
              market for it.
            </div>
          )}

          {slip.model ? (
            <ModelCard model={slip.model} homeName={slip.home} awayName={slip.away} />
          ) : (
            <div className="border border-nx-div px-3 py-2.5 text-[12px] text-nx-muted">
              No model output — not enough finished fixtures in this league to fit one.
            </div>
          )}

          <InsightAccordion insight={slip.insight} homeName={slip.home} awayName={slip.away} />

          <div className="flex flex-col gap-2 border border-nx-div px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-[10px] font-extrabold uppercase tracking-[.05em] text-nx-faint">
                NexusBet slip code
              </div>
              <code className="nx-num block break-all text-[12px] font-bold text-nx-text">
                {reference}
              </code>
            </div>
            <button
              type="button"
              onClick={handleCopy}
              className="min-h-[44px] shrink-0 border border-nx-div px-3 text-[11px] font-extrabold uppercase tracking-[.05em] text-nx-text sm:min-w-[84px]"
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
