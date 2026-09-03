const TABS = [
  { id: 'predictions', label: 'Board' },
  { id: 'tracker', label: 'Tracker' },
  { id: 'chat', label: 'Lounge' },
];

const SPORTS = [
  { value: '', label: 'All sports' },
  { value: 'football', label: 'Football' },
  { value: 'basketball', label: 'Basketball' },
  { value: 'volleyball', label: 'Volleyball' },
];

const DAY_OPTIONS = [
  { value: 1, label: 'Today' },
  { value: 2, label: 'Next 2 days' },
  { value: 3, label: 'Next 3 days' },
  { value: 7, label: 'Next 7 days' },
];

/**
 * Persistent header: identity, connection, search, tabs.
 *
 * The tagline is load-bearing. This is a research terminal over public data, and
 * saying so in the masthead is the honest framing the rest of the product keeps.
 */
export default function NavBar({
  activeTab,
  onTabChange,
  status,
  searchActive,
  query,
  onQueryChange,
  sport,
  onSportChange,
  days,
  onDaysChange,
  onClearSearch,
}) {
  const connected = status === 'open';
  const selectClass =
    'min-h-[44px] border border-nx-div bg-nx-surface px-2.5 text-[12px] font-semibold text-nx-text';

  return (
    <header className="sticky top-0 z-50 border-b-2 border-nx-div bg-nx-bg px-4 pt-3 sm:px-6">
      <div className="mx-auto max-w-5xl">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-baseline gap-1.5">
              <span className="text-[20px] font-extrabold leading-none tracking-tight sm:text-[22px]">
                NEXUSBET
              </span>
              <span className="border-b-2 border-nx-accent text-[20px] font-extrabold leading-none text-nx-accent sm:text-[22px]">
                AI
              </span>
            </div>
            <p className="mt-1 text-[10px] uppercase tracking-[.08em] text-nx-faint sm:text-[11px]">
              Research terminal, not a sportsbook
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2 pt-1">
            <span
              className={`h-[7px] w-[7px] shrink-0 ${
                connected ? 'nx-live-dot bg-nx-accent' : 'bg-nx-faint'
              }`}
            />
            <span className="text-[11px] font-semibold text-nx-muted">
              {connected ? 'Connected' : status === 'connecting' ? 'Connecting' : 'Offline'}
            </span>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <label className="sr-only" htmlFor="nx-search">
            Search fixtures by team or league
          </label>
          <input
            id="nx-search"
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search any team or league — Arsenal, Lakers, Serie A…"
            className="min-h-[44px] w-full min-w-0 flex-1 border border-nx-div bg-nx-surface px-3 text-[13px] text-nx-text placeholder:text-nx-faint sm:w-auto"
          />
          <select
            value={sport}
            onChange={(event) => onSportChange(event.target.value)}
            aria-label="Filter search by sport"
            className={selectClass}
          >
            {SPORTS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={days}
            onChange={(event) => onDaysChange(Number(event.target.value))}
            aria-label="How many days ahead to search"
            className={selectClass}
          >
            {DAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>

        {searchActive ? (
          <div className="py-3">
            <button
              type="button"
              onClick={onClearSearch}
              className="min-h-[44px] text-[12px] font-bold text-nx-accent-hi"
            >
              ← Back to today&apos;s board
            </button>
          </div>
        ) : (
          <nav className="mt-3 flex gap-5" aria-label="Sections">
            {TABS.map(({ id, label }) => {
              const active = activeTab === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onTabChange(id)}
                  aria-current={active ? 'page' : undefined}
                  className={`min-h-[44px] border-b-2 text-[14px] font-bold ${
                    active
                      ? 'border-nx-accent text-nx-text'
                      : 'border-transparent text-nx-faint'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </nav>
        )}
      </div>
    </header>
  );
}
