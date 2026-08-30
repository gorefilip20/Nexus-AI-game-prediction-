import { Search, X } from 'lucide-react';

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
 * Global fixture search.
 *
 * The day range is exposed rather than fixed because each extra day costs one
 * upstream schedule request per sport against a limited daily quota — the user
 * should be able to see and control that.
 */
export default function SearchBar({
  query,
  onQueryChange,
  sport,
  onSportChange,
  days,
  onDaysChange,
  state,
  onClear,
}) {
  return (
    <div className="border-b border-[#213743] bg-[#1a2c38]/60 px-6 py-3">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a96a3]" />
          <input
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search any team or league — Brighton, Lakers, Serie A…"
            aria-label="Search fixtures by team or league"
            className="w-full rounded-lg border border-[#213743] bg-[#0f212e] py-2.5 pl-9 pr-9 text-sm text-white placeholder:text-[#8a96a3] focus:border-[#00e701]/50 focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              onClick={onClear}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-[#8a96a3] transition hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          ) : null}
        </div>

        <select
          value={sport}
          onChange={(event) => onSportChange(event.target.value)}
          aria-label="Filter by sport"
          className="rounded-lg border border-[#213743] bg-[#0f212e] px-3 py-2.5 text-sm font-bold text-white focus:border-[#00e701]/50 focus:outline-none"
        >
          {SPORTS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          value={days}
          onChange={(event) => onDaysChange(Number(event.target.value))}
          aria-label="How many days ahead to search"
          className="rounded-lg border border-[#213743] bg-[#0f212e] px-3 py-2.5 text-sm font-bold text-white focus:border-[#00e701]/50 focus:outline-none"
        >
          {DAY_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>

        {state === 'searching' ? (
          <span className="text-xs font-bold uppercase tracking-wider text-[#8a96a3]">
            Searching…
          </span>
        ) : null}
      </div>
    </div>
  );
}
