# NexusBet AI — redesign brief

Paste everything below the line into Claude Design. It is written as a single
prompt; nothing outside this file is needed to act on it.

---

## The job

Redesign the entire front end of **NexusBet AI**, a multi-sport fixture and
analysis dashboard. The current UI is functional but reads as machine-generated:
uniform dark cards, one neon accent, an icon beside every label, everything a
rounded box on the same spacing scale. I need it to look like a small, opinionated
team built it over eighteen months — a real product with a point of view.

This is going live, so every screen and every state has to be designed, including
the unglamorous ones. Do not design three hero screens and leave the rest.

## What the product actually is

A dashboard over public sports data covering **football, basketball and
volleyball**, men's and women's competitions alike. For each upcoming fixture it
shows:

- real bookmaker odds, with the bookmaker's margin stripped out
- probabilities from a statistical model fitted on that league's real results
- a generated written analysis (recent form, head-to-head, expected value)
- a settlement record of picks the app made before kickoff and later graded

It places no bets and is not a sportsbook. It is closer to a research terminal
than a casino.

**This matters for the design.** The product's whole credibility rests on not
overstating itself: the tracker reports no win rate until picks actually settle,
model output is labelled as an estimate with its sample size, and every value
claim carries a caveat that the betting market is usually better calibrated than
the model. The visual language must support that restraint. No hype, no glow, no
"AI-POWERED" badges, nothing that implies certainty the numbers do not have. A
design that looks like a get-rich tipster site would misrepresent the product and
put us on the wrong side of gambling advertising rules.

## The functional problem, which is the real reason to redesign

The current layout was built when the board showed **9 fixtures** — three per
sport, in a three-column card grid. The backend now returns up to **200 fixtures
per sport**, across dozens of leagues including women's competitions.

A grid of large equal-weight cards is the wrong pattern for hundreds of rows. It
buries the day's card under scrolling and gives a Champions League tie the same
visual weight as a third-tier fixture. Look at how people actually scan a full
day's football: dense rows grouped by competition, collapsible, with the fixture,
time, price and one signal per line. That is the layout to design toward.

So: **rethink the information architecture, don't restyle the boxes.**

## What currently exists — design all of it

Three tabs plus a global search, eleven components.

**Global**
1. `NavBar` — wordmark, three tabs, live connection status. Currently 120px tall
   on mobile with short tab labels.
2. `SearchBar` — text search across teams and leagues, a sport filter, a
   date-range select. Sits above the tabs and spans every sport.
3. Footer — a compliance paragraph with a BeGambleAware link and an 18+ notice.
   Legally required. Design it so it is read, not buried in grey.

**Tab 1 — the board (the primary screen)**
4. `PredictionsPanel` — the fixture list. Must handle 9 rows and 300 rows.
5. `PredictionCard` — one fixture: sport, league, teams, kickoff, market
   favourite, best price, market-implied probability, a copyable slip code, and
   a "high confidence" marker on some.
6. `ModelBreakdown` — collapsible: model probabilities for home/draw/away as
   bars, expected goals or points, and an expandable set of over/under,
   handicap, both-teams-to-score and correct-score numbers.
7. `InsightPanel` — collapsible "AI Insight & Analysis": bulleted prose under
   Model / Team form / Head-to-head / Expected value, a six-column value table
   (outcome, price, model %, market %, gap, EV), and a caveat block.

**Tab 2 — the tracker**
8. `TrackerPanel` — three headline stat tiles (settled win rate, current streak,
   awaiting settlement) plus an audit table of every recorded pick: fixture,
   pick, price, settlement status, and an expandable stored justification.

**Tab 3 — the lounge**
9. `ChatPanel` — a live chat room: a message list, a presence count, connection
   status, and a composer. Currently a sidebar plus a 65dvh scroll area.

**Cross-cutting**
10. `DataProvenanceNotice` — states whether data is live or sample, and where the
    numbers came from.
11. `CachedDataBanner` — shown when the daily API budget is spent and the app is
    serving saved analysis, with a countdown to when live updates resume.

## Every state that must be designed

These are real states in the running app, not hypotheticals. Each needs a
designed treatment:

| State | Where |
| --- | --- |
| Loading the board | Board |
| Backend unreachable, with retry | Board |
| No fixtures returned today | Board |
| Serving saved analysis, with countdown | Board, Tracker |
| Sample data (no API key configured) | Board, Tracker |
| Fixture with no market odds — "Unpriced" | Card |
| League with too little history — "No model output" | ModelBreakdown |
| Thin model fit — "Provisional" | ModelBreakdown, Insight |
| High-confidence pick | Card |
| Searching | Search |
| Search returned nothing, listing what was scanned | Search |
| Search failed | Search |
| No settled picks yet — win rate deliberately blank | Tracker |
| No picks recorded yet | Tracker |
| Chat connecting / disconnected / reconnecting | Lounge |
| Empty chat room | Lounge |

The "not yet" states carry real weight here. An empty tracker is the honest
default for a new deployment and users will see it first — design it as a
considered screen that explains itself, not a grey box apologising.

## The tells to remove

From an audit of the current code:

- **17 instances of `uppercase tracking-wider` micro-labels.** The single
  strongest generated-UI signal. Nearly all should go.
- **16 `rounded-xl` containers.** Everything is a card. Introduce lists, rules,
  tables, and plain sections with no container at all.
- **11 `font-black` headings.** One weight doing all the emphasis work.
- **5 `animate-pulse` dots.** Decorative motion. Keep at most one, where it
  genuinely signals a live connection.
- **A gradient panel** on the tracker tiles. Delete it.
- **One saturated accent (`#00e701`) used 49 times** — buttons, text, borders,
  bars, badges. Colour currently means nothing because it is everywhere.
- **No typeface.** The app runs on the default system stack. This alone makes it
  read as unfinished.
- **A palette lifted from a well-known sportsbook** (`#0f212e` / `#1a2c38` /
  `#213743`). Recognisable, and not ours.

## Direction

Study how real sports-data and financial tools handle density and trust —
Flashscore, Oddschecker, Understat, FBref, Bloomberg terminals, Betfair's
exchange grid. What they share:

- **A real typeface with a real hierarchy.** Consider a tabular-figure face for
  numbers so odds and percentages align in columns. Numbers are the content here;
  they deserve the same care as the headline.
- **Colour as information, not decoration.** Green means a settled win, red a
  loss, amber a caveat. Nothing else is coloured. A pick being "high confidence"
  can be shown by weight or position rather than another green badge.
- **Density with rhythm.** Rows, rules and grouping by competition rather than
  uniform cards. Let a big fixture look bigger.
- **Restraint in motion.** Live data can update without pulsing.
- **A real identity.** A wordmark someone drew, not a lucide icon beside text.
  It can be plain — plain and specific beats generic and glowing.

Give it a point of view. An unusual but disciplined choice — a distinctive
accent, a strong editorial grid, generous or deliberately tight spacing — will do
more than polishing what is there. Asymmetry, an off-centre grid, or a genuinely
unexpected colour would all be welcome if committed to consistently.

Dark-first is right for this product, but the current dark is a default. Make it
a decision.

## Hard constraints

- **Mobile down to 375px.** Verified working today: no horizontal overflow, tap
  targets at least 44px, slip codes readable without truncation, chat composer
  reachable above the on-screen keyboard. Do not regress these.
- **Wide tables** (the six-column EV table, the tracker audit) must stay inside
  their own horizontal scroll containers on mobile.
- **Accessibility:** WCAG AA contrast, visible focus states, real semantic
  structure. Status must never be conveyed by colour alone — a settled win needs
  a label or mark as well as green.
- **Theme:** the page renders against the viewer's theme. Define a complete
  palette rather than relying on defaults, and give the body an explicit
  background.
- **Icons:** lucide-react is available. Use far fewer than today.
- **No stock photography of stadiums or cash.** No trophies, no money, no flames.

## What to deliver

1. A design system: palette with named roles, type scale, spacing scale, and the
   rules for when colour is allowed to appear.
2. The three main screens at desktop and at 375px.
3. Every component in the list above, in each of its states from the table.
4. The empty, error and stale states designed with the same care as the
   populated ones.
5. A short written rationale — what the point of view is, and which conventions
   you broke on purpose.

Start with the board at 375px holding 40+ fixtures across several leagues. If
that screen works, the rest follows.
