# Handoff: NexusBet AI — Fixture Board Redesign

## Overview
A redesigned prediction/fixture board for NexusBet AI (sports-betting research terminal), rebuilt from the `Nexus-AI-game-prediction` repo's UI onto the Modernist design system, dark-first with a green accent. Covers three tabs (Board/Upcoming, Tracker, Lounge/chat) plus global search, ~16 UI states (loading, error, empty, stale, sample-data, unpriced, provisional, no-model, high-confidence, tracker/lounge empties), and a dense grouped-by-league row layout at mobile widths.

## About the Design Files
The files in this bundle (`NexusBet AI Redesign.dc.html`, `FixtureRow.dc.html`) are **design references built in an HTML prototyping tool** — they demonstrate exact layout, copy, states, and interaction, not production code to copy verbatim. Recreate this UI in the target codebase's real stack (React/Vue/native — whatever the repo already uses) using its existing component patterns, data layer, and routing. If no frontend stack exists yet, choose the framework best suited to the existing backend/repo.

## Fidelity
**High-fidelity.** Colors, spacing, typography, copy, and state logic below are final — implement pixel-for-pixel using the target codebase's component libraries and CSS approach (don't re-derive these values from scratch).

## Design Tokens

Dark theme, single accent (green), Archivo type, zero border-radius everywhere (Modernist system rule).

| Token | Value | Use |
|---|---|---|
| `--nx-bg` | `#0b0d0b` | Page background |
| `--nx-surface` | `#141712` | Inputs, prototype-control bar |
| `--nx-surface-2` | `#1d2118` | Skeleton blocks, probability-bar track |
| `--nx-text` | `#f2f5ef` | Primary text |
| `--nx-muted` | `#a9b3a4` | Secondary text/body copy |
| `--nx-faint` | `#6c766a` | Labels, timestamps, tertiary text |
| `--nx-div` | `#2b3227` | All 1–2px rule/border lines |
| `--nx-accent` | `#22c55e` | Primary accent — live dot, active tab underline, primary buttons, high-confidence tag, WIN status border |
| `--nx-accent-hi` | `#4ade80` | Links, banner left-border, provisional-model note, insight caveat text |
| `--nx-accent-lo` | `#16803c` | Reserved darker accent step (pressed states) |

- Font: **Archivo** (heading + body, per Modernist system), `system-ui, sans-serif` fallback.
- Border radius: **0 everywhere** — no rounded corners anywhere in this design.
- Rule weight: 1px for row dividers, 2px for section/header dividers (`border-top/bottom: 2px solid var(--nx-div)`).
- Focus ring: `2px solid var(--nx-accent)`, `outline-offset: 2px` on all interactive elements (`:focus-visible`).
- Minimum tap target: 44px height on all buttons/inputs/rows (mobile-first, 375px design width).
- Numeric figures use tabular-nums (`font-variant-numeric: tabular-nums`) everywhere a number appears (odds, percentages, times, counts).

## Screens / Views

### 1. Header (persistent, sticky top)
- Logo lockup: "NEXUSBET" (800 weight, 22px) + "AI" in accent green with a 2px accent underline + small caps tagline "research terminal, not a sportsbook" (11px, faint, uppercase).
- Right side: connection indicator — 7px accent-green pulsing dot (2s pulse animation, opacity 1↔0.35) when connected, static faint-grey dot when offline; label "Connected"/"Offline".
- Search row: full-width text input (44px min-height, placeholder "Search any team or league — Arsenal, Lakers, Serie A…") + sport `<select>` (All/Football/Basketball/Volleyball) + days-ahead `<select>` (Today/Next 2/3/7 days).
- Tabs (hidden while search is active): **Board**, **Tracker**, **Lounge** — active tab gets 2px accent-green underline + full-brightness text; inactive tabs are muted with transparent underline.
- 2px `--nx-div` bottom border under the whole header.

### 2. Prototype state switcher (dev-only control bar, not part of shipped product)
Dashed top border, surface background. A `<select>` cycles the whole board through: Live-healthy / Sample data (no API key) / Serving saved analysis (stale) / Loading / Backend unreachable / Empty day. A second `<select>` (visible only on the Lounge tab) cycles chat connection: Connected / Connecting / Disconnected. **Do not ship this bar** — it exists purely to demo states; the real implementation should drive these states from actual API/loading conditions.

### 3. Search results (overlays Board/Tracker/Lounge when query length ≥ 2 chars)
- **Searching** state: small pulsing green dot + `Searching schedules for "{query}"…`
- **Error** state: 2px accent-bordered box, "Search failed" / "The search endpoint did not respond. Try again in a moment."
- **Results** state: heading `Results for "{query}"`, a "Back to today's board" ghost button, a one-line scan summary (`Scanned N scheduled fixtures across D days… Matched M.`), then either a list of `FixtureRow` components or a **no-results** panel ("No scheduled fixture matched" + guidance copy).

### 4. Board tab (default view)
- Title "The board" + one-line description.
- Conditional banner (max one shown): **Stale** ("Showing saved analysis…", accent-hi left border), **Sample data** ("No sports API key is configured…", accent-hi left border), or **Live** ("Live via API-Sports…", plain border, no accent).
- High-confidence summary line: "**N** of M fixtures clear the confidence threshold" + caveat sentence.
- Sport filter chips: All sports / Football / Basketball / Volleyball — active chip is filled `--nx-text` on `--nx-bg` (inverted), inactive is outlined `--nx-div`.
- **League groups**: each league is a collapsible section — header row shows league name (bold 15px) + sport label + fixture count (faint uppercase 11px) + Show/Hide toggle, on a 2px top divider. Expanded shows a stack of `FixtureRow` children (see Component 8 below), sorted by kickoff.
- **Loading state**: 6 skeleton rows (flat grey blocks mimicking the row grid) + "Loading today's fixtures…" caption.
- **Error state**: 2px accent-bordered box, "Engine unreachable" + explanation + accent-filled "Retry" button.
- **Empty state**: outlined box, "No fixtures today" + explanatory copy (no invented content to fill the gap).
- Footnote: slip-code disclaimer (11px, faint).

### 5. Tracker tab
- Title "Tracker" + description.
- Optional stale banner (same treatment as Board).
- 3-stat row (grid, auto-fit min 180px), separated by 1px vertical rules, bounded by 2px top/bottom rules: **Settled win rate** (34px tabular number + hint), **Current streak**, **Awaiting settlement**.
- Data table (horizontally scrollable on mobile) — columns: Fixture/league, Recorded pick (+ expandable "Why this pick" reasoning row), Price, Settlement (status tag: WIN gets accent-green border + bold; LOSS/VOID/PENDING get neutral outline).
- **Empty state**: outlined box, "No picks recorded yet" + explanation.

### 6. Lounge tab (chat)
- Header row: "Punter lounge" title + status line (Connected/Connecting/Disconnected copy) on the left, "Online" count (26px tabular number) on the right.
- Disclaimer line: messages are unverified user content.
- Scrollable message list (min-height 340px, max 52dvh) — each message: username (bold 12px) + timestamp (right-aligned, tabular, faint) on one row, message text below. 1px top divider between messages.
- **Empty state** (no messages, or disconnected): centered faint text, "No messages yet. Say hello to the lounge."
- Composer: text input (disabled + placeholder "Reconnecting…" when not connected) + accent-green "Send" button (disabled when disconnected or draft empty).

### 7. Footer
Compliance/legal copy: platform reads public data only, places no bets, not affiliated with any sportsbook; BeGambleAware link (styled `--nx-accent-hi`, hover `--nx-accent`); 18+ only.

### 8. FixtureRow (child component, repeats in Board groups and Search results)
- Collapsed row (44px min-height button, 5-column grid: kickoff time | team names + high-confidence tag | odd/unpriced | probability % | chevron):
  - Kickoff time: tabular, faint, e.g. "Tue, 14:30, 12 Sep".
  - Team names: "{Home} vs {Away}", bold when high-confidence (800/14px) vs normal (600/14px), truncated with ellipsis.
  - High-confidence tag (only if flagged): "High confidence · {N}%" — 10px, 800 weight, uppercase, accent-green.
  - Odd: tabular bold, or an "Unpriced" outlined tag if odds unavailable.
  - Probability %: tabular, muted (hidden if unpriced).
  - Chevron: "+" collapsed / "−" expanded.
- Expanded panel (on row click):
  - League line (faint 11px).
  - **No-model note** (outlined box) if the league has no fitted model.
  - **Model card** (bordered box) if a model exists: "Model probability" header + expected-value text (e.g. "1.8–1.1 xG"), then a stacked 3-row probability bar chart (Home/Draw/Away, 4px bar height, accent-green for home, muted for draw/away), a "Provisional: fitted on only N matches" note (accent-hi) when the model is provisional/unreliable, and a "More markets"/"Hide markets" toggle revealing a market-breakdown caption.
  - **AI insight & analysis** accordion (bordered box): categorized bullet points (Model / Team form / Head-to-head / Expected value), an optional value-bet table (Outcome/Price/Model%/Market%/Gap/EV columns, tabular), a caveat line (accent-hi), and a disclosure that the text is rule-based-engine generated, not LLM-written.
  - Slip-code block: monospace-style code chip + "Copy"/"Copied" button (writes to clipboard, resets after 2s).

## Interactions & Behavior
- **Search**: debounced ~450ms after 2+ characters typed; typing "fail" in the query is a demo hook that forces the error state — real implementation replaces with actual API error handling.
- **League collapse/expand**: per-league toggle state, default expanded.
- **Row expand**: per-fixture toggle; independent "more markets" and "AI insight" sub-toggles nested inside.
- **Tracker "why this pick"**: per-row toggle revealing a justification string.
- **Chat**: disabled composer when not connected; Enter/submit appends a message with current timestamp; connection states (open/connecting/disconnected) gate sending and show placeholder/empty-state copy.
- **Retry button** (board error state): resets scenario to live in the prototype — real implementation re-fetches from the prediction engine.
- **Copy slip code**: clipboard write with a 2-second "Copied" confirmation label revert.
- All buttons/rows have keyboard focus rings (`outline: 2px solid var(--nx-accent)`), and are real `<button>`/`<select>`/`<input>` elements — no click-only divs.

## State Management
Minimal state needed to reproduce:
- `activeTab`: 'board' | 'tracker' | 'lounge'
- `scenario` (data status, in prod driven by real fetch state, not a picker): 'live' | 'sample' | 'stale' | 'loading' | 'error' | 'empty'
- `sportFilter`: '' | 'football' | 'basketball' | 'volleyball'
- `collapsedLeagues`: map of league key → collapsed boolean
- `expandedFixtures` / `expandedMarkets` / `expandedInsights`: maps of fixture id → boolean
- `trackerWhyOpen`: map of tracker row key → boolean
- `search`: query string, sport filter, days-ahead, status ('idle' | 'searching' | 'error' | 'results')
- `chat`: connection status, message list, draft text
- Fixture data shape per row: id, sport, league, tier, home/away teams, kickoff datetime, odds availability + value + bookmaker, prediction label, market probability %, highConfidence flag + confidence %, model object (method name, reliable flag, trainedOn count, expected value, outcome probabilities, totals/handicaps/btts), insight object (categorized bullets, optional value-bet table, caveats), slipCode string.

## Assets
No external images — the design is fully typographic/data-driven (no photography, no icons beyond a text chevron "+"/"−"). Font is Archivo (loaded via the Modernist design-system stylesheet). If Lucide icons are wanted per the Modernist spec, none are currently used in this design; note this if introducing icons later.

## Screenshots
`screenshots/01-board.png`, `02-tracker.png`, `03-lounge.png` — reference captures of the three main tabs in the "Live — healthy" demo state.

## Files
- `NexusBet AI Redesign.dc.html` — main prototype: header, search, all three tabs, all states, state-switcher demo control, footer, and a design-rationale write-up at the bottom of the file.
- `FixtureRow.dc.html` — child component: single fixture row (collapsed + expanded), reused by the Board's league groups and by Search results.

Both files load the Modernist design-system bundle (`_ds/modernist-.../styles.css` + `_ds_bundle.js`) — not included in this handoff folder; treat that as the styling reference (color ramps, base component classes) already documented in the tokens table above, not a runtime dependency to ship as-is.
