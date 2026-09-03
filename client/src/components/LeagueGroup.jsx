import { useId, useState } from 'react';
import FixtureRow from './FixtureRow.jsx';

const SPORT_LABELS = { football: 'Football', basketball: 'Basketball', volleyball: 'Volleyball' };

/**
 * One competition's fixtures, collapsible.
 *
 * Grouping is what makes a few hundred fixtures scannable: a reader looks for a
 * competition first and a match second, which is how a printed card works too.
 */
export default function LeagueGroup({ league, sport, fixtures }) {
  const [open, setOpen] = useState(true);
  const panelId = useId();

  return (
    <section className="border-t-2 border-nx-div">
      <div className="flex items-center justify-between gap-3 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-[15px] font-bold">{league ?? 'Unknown league'}</h3>
          <div className="text-[11px] uppercase tracking-[.05em] text-nx-faint">
            {SPORT_LABELS[sport] ?? sport} · {fixtures.length}{' '}
            {fixtures.length === 1 ? 'fixture' : 'fixtures'}
          </div>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="min-h-[44px] shrink-0 px-2 text-[11px] font-extrabold uppercase tracking-[.05em] text-nx-faint"
        >
          {open ? 'Hide' : 'Show'}
        </button>
      </div>

      {open ? (
        <div id={panelId}>
          {fixtures.map((slip) => (
            <FixtureRow key={`${slip.sport}:${slip.id}`} slip={slip} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
