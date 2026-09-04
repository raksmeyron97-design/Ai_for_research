# Phase 21 — Production Reproducibility, Workspace Completion & Operational Hardening

**Branch:** `feat/phase-21-production-reproducibility-hardening`
**Baseline:** Phase 20 (`f532c17`) — 1,508 tests / 136 files, 45 browser tests

Phase 21 adds no large feature. It answers two questions:

> Can another developer clone this repository, start from a clean database,
> run the documented commands, and get the same trustworthy research
> workspace without hidden manual state?

> Can the researcher use the system confidently without AI availability,
> without losing provenance, without hidden data corruption, and without
> trusting an unverified automated conclusion?

**Live AI benchmark: DEFERRED.** 0 live Gemini calls, 0 live OpenAI calls were
made building this phase.

---

## 1. What the audit found (21A), before any code

Seven things, in rough order of how badly they undermined the previous phases'
claims.

1. **The clean reset had never been executed.** Phase 20 applied its
   migrations forward onto a database that already held the earlier ones. The
   history table showed it: **18 rows against 25 migration files**, with Phase
   16 and 17 rows missing while their objects existed, and
   `20260902000200_phase20_source_search` missing while `search_project_sources`
   was present in the database. Every schema claim rested on an environment
   nobody could rebuild.
2. **`ai:benchmark:dry` overwrote the live provider record**, which Phase 20
   documented and worked around by hand.
3. **The source search had no caller.** Phase 20 built
   `search_project_sources`, its indexes and its route, and `LiteratureWorkspace`
   went on fetching `/citations` and filtering the array in the browser.
4. **The framework's stored coordinates were unreachable.** `listFrameworkNodes`
   ordered by `created_at`, so a node could be moved and the list would not
   move with it.
5. **No CI at all.** Every gate was a command someone had to remember. Items
   1-3 are what that costs.
6. **`supabase/config.toml` declared a seed file that did not exist**, so every
   reset ended in a warning a newcomer cannot distinguish from a failure.
7. **The isolation suites were five hard-coded `docker exec` lines** naming
   this machine's container, failing with `command not found` when Docker was
   not on PATH — which reads like a broken test rather than a missing tool.

---

## 2. Reproducibility (21B)

### The clean bootstrap, executed

```
supabase db reset --local
```

**26 / 26 migrations apply in order from an empty database, with no manual
step**, producing 35 tables with RLS enabled on every one and 124 functions.
The history drift in finding 1 is gone because the reset rebuilt the table,
not because anything was edited.

All six isolation suites then pass against *that* database rather than an
accreted one.

### From a fresh clone to a working environment

```bash
npm ci
cp .env.example .env.local          # fill in Supabase + (optionally) provider keys
supabase start                       # Docker Desktop must be running
npm run db:reset                     # all migrations from empty
npm run dev
```

Nothing else. No manually applied migration, no untracked fixture, no
machine-specific path. `tests/production-readiness.test.ts` fails the build if
a variable the source reads is missing from `.env.example`, so this cannot
quietly grow a step.

### The isolation runner

`scripts/db-isolation.sh` replaces the five `docker exec` lines. It finds the
Docker binary where Docker Desktop actually puts it (`~/.docker/bin`, which a
non-login shell does not pick up), reads the container name out of
`config.toml` rather than assuming this directory's name, and distinguishes
the three outcomes §62 requires:

| exit | meaning |
| --- | --- |
| 0 | passed |
| 1 | the suite failed |
| 2 | **NOT RUN**, with the specific reason |

`npm run db:verify:isolation:all` runs the whole column rather than stopping
at the first red cell, because "is the database sound after a reset" is not
answered by the first failure.

### The seed file

`supabase/seed.sql` now exists and is deliberately empty of rows. Every table
here is project-scoped behind an `auth.users` row, so global seed data would
mean shipping a fabricated account with someone's apparent research behind it.
Tests create the users they need. A reset gives a schema, not a scenario —
which also makes §48's empty-project state the default rather than a special
case.

---

## 3. Benchmark artifacts (21C)

### What the committed record actually is

Read against §10, `reports/ai-benchmark/latest.json` says:

```json
"suite": "smoke",
"providers": { "gemini": { "status": "LIVE" }, "openai": { "status": "LIVE" } },
"execution_modes": { "UNAVAILABLE": 12 },
"status": "NOT READY"
```

A provider `status` of `LIVE` means **the credential probe was accepted** and
52 and 118 models were enumerated. `execution_modes` says what happened next:
**all 12 of 12 scenario calls came back UNAVAILABLE**. No scenario has ever
produced a scored result. Every other run under `raw/` is `{"MOCKED": 765}`.

So the artifact is a successful category-1 credential probe plus a *failed*
category-2 smoke test, and provider model metadata was doing exactly the
implying §10 forbids. It is preserved byte-for-byte (§61) and labelled for
what it is in `reports/ai-benchmark/README.md`, which sets out all five
categories — credential probe, live smoke test, live benchmark, dry benchmark,
harness validation — and states `LIVE BENCHMARK = DEFERRED`.

### The separation

A dry run resolves its output to a `dry/` subdirectory, and the redirect
applies to an explicitly set `AI_BENCH_OUT_DIR` too: an operator who redirects
the harness has the same live record to lose, and a safety that only applies
to people who configured nothing is not a safety property. The live path is
left exactly where it has always been — moving it would relocate historical
evidence to make the tree symmetric.

Artifacts label themselves. `mode` is `"live"` or `"dry"`, **required** rather
than optional so no caller can omit what the numbers are, and a dry markdown
report opens with a banner saying so.

`provider_calls` makes "0 live calls" machine-checkable. It is deliberately
**not** the request budget's counter: the budget authorises *executions*, and a
stubbed execution spends budget exactly like a real one — a full dry run
spends 765 without opening a socket. It sums each non-`MOCKED` execution's own
call count, which already includes the retry, the cross-provider fallback and
the reviewer pass, because those cost real money too.

### Executed

```
$ npm run ai:benchmark:verify-isolation
PASS — every live artifact is byte-identical.
PASS — dry artifact is labelled mode=dry.
PASS — 0 provider calls.
PASS — every execution mode is MOCKED.
```

---

## 4. Conceptual framework (21D)

Complete against §13's list:

| Capability | Where |
| --- | --- |
| create / delete node | Phase 20 routes, unchanged |
| **edit node (rename)** | new, unmapped nodes only |
| link / unlink canonical construct | Phase 20 |
| create / edit / delete relationship | Phase 20 (type and hypothesis are editable) |
| link relationship to hypothesis | Phase 20 |
| **reorder nodes, layout persisted** | new — `reorder_framework_nodes` |
| accessible list representation | Phase 20, now an `<ol>` |

**Reordering** is Move up / Move down, not a drag handle: dragging is the
mouse-only interaction §33 rules out. The whole order goes in one `PUT` to
`reorder_framework_nodes`, not one `PATCH` per node — as *n* requests a
reorder can half-apply (leaving an order nobody chose), races between two tabs,
and writes *n* audit entries for one decision. The function refuses a partial
order, a duplicated id, and an order naming another project's node; that last
one is caught by comparing updated rows against array length, because a
right-length array with a foreign id passes the count check.

**Renaming** is offered only for unmapped nodes. A mapped node's name comes
from its construct, and an editable label beside it would be the second source
of truth canonical binding exists to remove.

**Layout stays presentation data (§15).** Nothing in `validation.ts`,
`cross-system.ts` or any metric reads `position_x`/`position_y`. The Phase 21
isolation suite asserts a reorder does not disturb the construct binding.

Concepts are an `<ol>` rather than a `<ul>` with a rendered number: the list
has an order the researcher controls, and an ordered list has a screen reader
announce "3 of 7" without putting a digit inside the concept's name.

### A real bug, found by the rename field and older than it

`useDialogOverlay` handled Escape in the **capture** phase on `document`, so it
ran before whatever the researcher was typing in. Escape inside any control in
any overlay closed the entire workspace.

Moving it to bubble was not enough, and finding out why needed a real browser.
**Next's App Router hydrates the whole document**, so React's delegated
listener is attached to `document` — the same node. `stopPropagation()` stops
an event reaching *other* nodes and does nothing to a sibling listener on the
node currently dispatching. Testing Library renders into a container div, so
React's root is not `document` there and the identical code behaves correctly:
**jsdom could not have found this.** The overlay now stands down on
`defaultPrevented`, and the field also calls `stopImmediatePropagation()` on
the native event as the order-independent guarantee.

---

## 5. Source search (21E)

The Sources tab is now the caller for `search_project_sources`. Text search,
year range, verification status, has-a-DOI, has-evidence and is-cited are all
database predicates; the list pages 25 at a time over a stable sort with `id`
as the tiebreaker.

Three details that are decisions rather than defaults:

* **has-evidence and is-cited are separate filters** because they are separate
  questions. An excerpt can be saved from a source and never attached to a
  sentence; that source has evidence and is not cited.
* **each is three-state, not a checkbox.** "No opinion" and "explicitly no"
  are different queries, and "sources missing a DOI" is a real thing to look
  for when cleaning a bibliography.
* **the theme filter sends a theme id**, not the list of citation ids assigned
  to it. The old shape precomputed the answer in the browser, went stale the
  moment an assignment changed, and could not be paged.

**§18, what the box searches.** The empty state says *No sources in this
library match the current search*, and says plainly that it searches what the
researcher has added to this project rather than the published literature —
because "no results" from a search field is otherwise read as "no such
research exists".

**§32, bounded loading.** The full citation list is still needed by Themes,
Compare, Research gaps and Evidence, which are pickers over the library, so it
is fetched when one of those opens and cancelled if the researcher moves on
first. Opening Sources no longer loads the project's whole bibliography.

---

## 6. Traceability (21F)

Already whole from Phases 19-20, and re-verified here:

* claim → citation → evidence → source
* source → evidence → claim → section (`SourceDetailPanel`)
* exact claim navigation via `locateClaim`, with `claim_not_located` returned
  as a real answer rather than a silent nearest-sentence highlight

New: **construct → indicators → questionnaire items → hypotheses → framework
relationships → claims** (§25). The chain existed as five tables behind five
screens, so the question a researcher actually asks about a concept — *what
depends on this, and is it measured at all?* — meant opening all five and
joining by eye.

Three properties, each with a test:

* **Nothing is inferred.** Claims are reached only through a stored
  `research_claim_methodology_links` row, never by finding the construct's
  name in the manuscript. A claim reading "Teacher motivation is hard to
  measure" is not traceable to the construct because the words match.
* **A missing link is reported as missing**, not scored. "No questionnaire
  item asks about this concept" is something a researcher can go and fix;
  "40%" is not.
* **The hypothesis position is read per link**, not off the construct. The
  same concept is predictor in one hypothesis and outcome in another.

Assembled server-side and scoped to one construct: the joins reduce hard, so
doing the work next to the data sends hundreds of bytes instead of the
project, and thirty constructs do not cost thirty traces to render a list of
names.

---

## 7. Browser verification (21G)

**71 tests, real Chrome, six widths — executed, twice consecutively green.**

### The regression matrix

| Area | 320 | 375 | 414 | 768 | 1024 | 1280 |
| --- | --- | --- | --- | --- | --- | --- |
| Workspace (no sideways scroll) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Manuscript editor usable | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Framework overlay | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Framework layout controls on screen | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Methodology overlay | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Research integrity overlay | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Research review overlay | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Source search + filters | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

Every cell is an executed browser assertion — overflow measured from
`scrollWidth`/`clientWidth`, control positions from real bounding boxes.

**1024 is new and is not filler.** Tailwind's `lg` breakpoint is 1024px, and
it is exactly where `WorkspacePanes` switches from a stacked tab row to a
three-column grid. A layout can be right on both sides of a boundary and wrong
precisely on it, and this was the one width the suite never measured. The spec
asserts panes are side by side at 1024 and stacked at 1023.

Keyboard and focus behaviour (§29) is asserted rather than assumed: reordering
is driven by `focus()` + `Enter` and never a click; the overlay traps focus and
returns it; Escape closes from outside a claiming control and is claimed by the
rename field.

### The suite was flaky, and the flakiness was contention

Two consecutive full runs failed four tests and then a different two, all with
the same signature: the project heading absent within the expect timeout. The
same tests pass 16 of 16 run serially. Playwright defaults to one worker per
core and every worker drives a cold page load against one `next start`.

| workers | wall time | failures |
| --- | --- | --- |
| 8 (default) | 13.1m | 5 |
| 4 | 8.8m | 4 |
| **2** | **4.2m** | **0** |

Fewer workers is not a trade here — it is faster outright, because a contended
run spends its time in expect timeouts before failing.

---

## 8. Performance (21H)

`npm run db:profile` builds a synthetic, deterministic fixture — **150
sources, 240 claims, 180 evidence rows, 300 links, 24 constructs, 36
indicators, 60 items, 24 hypotheses, 24 nodes, 40 relationships**, all from
`generate_series` and none from anyone's real project — and times the queries
the workspaces run, as the owner, under RLS.

| Query | Result | Time |
| --- | --- | --- |
| source search, first page | 25 rows | 4.9 ms |
| source search, text query | 25 rows | 8.8 ms |
| source search, uncited + no evidence | 25 rows | 9.0 ms |
| source search, last page (offset 125) | 25 rows | 2.6 ms |
| source search, DOI lookup | 1 row | 8.8 ms |
| framework load (nodes + edges) | | 4.3 ms |
| framework reorder (24 nodes) | | 13.4 ms |
| questionnaire load | 60 items | 2.4 ms |
| integrity review fetch (all rows) | | 5.7 ms |
| construct trace, items for one construct | 3 rows | 1.4 ms |

Budget: **200 ms** per interactive query (600 ms for the review's
whole-project fetch, which legitimately reads the project). These are
regression detectors, not SLOs — 200 ms catches a sequential scan over the
library or an N+1 collapsed into one statement without failing because a
container was busy.

Two things the fixture had to get right to be worth running: titles and
authors come from a small vocabulary so a text search matches a realistic
*fraction* of the library rather than one row; and evidence covers 120 of the
150 sources, leaving thirty with none, so the negative filters have rows to
find. The suite fails if that filter returns nothing.

**Stale async responses (§51)** are prevented by a request sequence number in
`SourceSearchPanel` and `ConstructTracePanel` — only the newest request may
write state, including the loading flag, since an older request finishing last
would otherwise clear the spinner while the newest is in flight. Both are
tested by resolving two responses deliberately out of order.

---

## 9. Observability (21I)

There was none before this. Adding logging to a system holding unpublished
research is not free: the obvious `log(message, context)` helper is one
careless call away from putting a manuscript into a log aggregator forever.

**So the shape is the safety.** `OperationalEvent` admits a name from a closed
vocabulary, opaque uuids, a status, a duration, a count, and an error *class*.
There is no `message`, no `details`, no `Record<string, unknown>`. §34's rule
is enforced by the type: there is nowhere to put the text.

`scrubEvent` is the runtime half, for what gets past the type via `as any` or a
generic. It drops unknown event names (so `log("saving " + title)` cannot
become an event name carrying a document title), drops ids that are not uuids
rather than truncating them (a prefix of a researcher's sentence is still a
researcher's sentence), and drops every unrecognised field.

Errors are classified, never quoted: `classifyError` reads a type and a flag,
and never matches on message text — matching a message is how a log ends up
containing it.

The vocabulary is deliberately researcher-facing, and has **no
`ai_proposal_applied`**: nothing is applied without a decision, and an event
name implying otherwise would misdescribe the system.

**Audit history (§35-§36)** is unchanged and separate. `methodology_events`
stays append-only, with the explicit revoke from Phase 18 and RLS-enforced
insert-only policies proven by the isolation suites. The reorder writes one
audit entry for one researcher action, **after** the statement commits; the
operational event on the refusal path reports `denied`, because an event
claiming a mutation that did not happen is worse than no event.

---

## 10. Security (21J)

### Route pattern

Every project-scoped route reaches the database through `authorizeProject`,
either directly or via `collectionRoute`/`entityRoute`. The seventeen routes
that do not import it by name all go through those factories — audited, no
drift found.

### Dependencies: 2 → 0

Both findings were **postcss**: four advisories about attacker-controlled CSS
(`</style>` in stringify output, three variants of arbitrary `.map` disclosure
via `sourceMappingURL`). `next` was flagged only because it bundles postcss
(`via: ["postcss"]`, `effects: []`), and npm's proposed fix was `next@16.3.4`
— a **semver-major framework upgrade to fix a build-time CSS parser**.

postcss is a devDependency run by Tailwind and autoprefixer over this
repository's own stylesheets. No user input reaches it and none of the four
advisories is reachable here. The exposure was two copies in the tree: 8.5.26
at top level, and next's bundled **8.4.31**. Raising the direct devDependency
to `^8.5.28` resolves both inside the same major.

`npm audit` now reports **0 vulnerabilities**, with build, full suite, lint and
typecheck all passing on it.

### Cross-project isolation

The Phase 21 suite adds the two functions that take a `p_project_id`
parameter, because a reader has to be able to tell whether that parameter is
the *barrier* or merely the *query*:

* `search_project_sources` — **§19, previously untested at the database
  level.** Project B passes A's id: nothing. Each filter path separately —
  DOI prefix, the negative `not exists` probes, a year range spanning
  everything, a status filter listing every status — nothing. A text query
  matching rows in *both* libraries returns only B's, which a count alone
  would pass by accident. `total_count` counts only visible rows, or the pager
  would leak the size of A's library while returning none of it.
* `reorder_framework_nodes` — cross-project reorder refused; a right-length
  array smuggling in one of A's nodes refused *whole*, with B's own order
  verified unchanged afterwards; partial orders and duplicate ids refused;
  and a positive control, without which every check above would pass on a
  function that refuses everything.

### Secrets and configuration (§55, §56)

`tests/production-readiness.test.ts` runs in `npm test`, needs no secret
values, contacts nothing, and never prints a secret — its failure messages
name files rather than quoting them. It checks that every `process.env.X` the
source reads is in `.env.example`; that no server secret sits in the
`NEXT_PUBLIC_` namespace (the anon key excepted — it is designed to be public
and carries no privilege beyond what RLS grants); that no env file, key
material or secret-shaped string is tracked; that migration timestamps are
unique and increasing; that declared seed files and isolation suites exist;
that both provider keys are optional and no provider module throws at import;
and that the benchmark README's `DEFERRED` claim still matches the artifact.

Two were deliberately falsified to confirm they are not vacuous: removing a
variable from `.env.example` fails the first, and adding a duplicate migration
timestamp fails the fifth.

### Error handling (§41, §42)

`dbErrorResponse` remains the single exit for a database failure and returns
*"…could not be completed. Nothing was changed — you can retry."* — never
constraint or column names. The reorder route returns one text for a duplicate
id, a partial order and a foreign node id alike, so a probe cannot learn from
the error whether some id exists in a project it cannot see. New panels assert
in test that their error text contains no `postgres|relation|column|constraint`.

---

## 11. AI boundary (§44-§46)

Unchanged and re-verified. AI remains advisory: proposals are recorded and a
researcher decides. The CI `checks` job builds and runs the whole suite **with
no provider credentials in the environment**, which is §44 asserted by a gate
rather than by a comment. `production-readiness.test.ts` additionally asserts
no provider module throws at import.

Context budgets are untouched: no workflow added this phase sends a whole
project, library or manuscript to a model. The construct trace and the source
search are both server-side and scoped, and neither goes near a provider.

**0 live Gemini calls. 0 live OpenAI calls.**

---

## 12. Test baseline

| | Phase 20 | Phase 21 |
| --- | --- | --- |
| tests | 1,508 | 1,595 |
| test files | 136 | 143 |
| browser tests | 45 | 71 |
| isolation suites | 5 | 6 |

New coverage is deliberately regression-shaped: the empty project across every
engine, stale-response races, benchmark artifact isolation, production
readiness, construct traceability, framework layout, and the query budgets.

---

## 13. Release gate

| Gate | Result |
| --- | --- |
| `npm test` | **1,595 passed / 143 files** |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npm run ai:benchmark:dry` | pass |
| `npm run ai:benchmark:verify-isolation` | pass — live artifacts byte-identical, 0 provider calls |
| `npm run test:browser` | **71 passed** (real Chrome, six widths) |
| `supabase db reset` | **26/26 migrations from empty** |
| Phase 17 isolation | PASS (executed) |
| Phase 17B isolation | PASS (executed) |
| Phase 18 isolation | PASS (executed) |
| Phase 19 isolation | PASS (executed) |
| Phase 20 isolation | PASS (executed) |
| Phase 21 isolation | PASS (executed) |
| `npm run db:profile` | all budgets met |
| `npm audit` | **0 vulnerabilities** |
| Live Gemini calls | **0** |
| Live OpenAI calls | **0** |

**NOT RUN — the CI workflow itself.** `.github/workflows/ci.yml` is new in
this phase and has never executed: there is no GitHub Actions runner in this
environment. Its YAML parses and every command in it was run locally, but
until it runs on a push its green-ness is an expectation, not a result.

---

## 14. Known limitations

Carried forward, still true:

* **the live AI benchmark remains deferred** — provider billing credit is the
  only blocker, and no scored live execution has ever completed
* external source verification is not source truth
* semantic conflict detection is advisory; linguistic item checks are heuristics
* numerical traceability matches a claimed number to a dataset column by a
  word-boundary name match
* unsupported claims may exist outside the modelled claim set
* ORCID is validated but not persisted
* no structured per-hypothesis result is stored, so `result_traceability` is
  permanently `not_computable` — a schema change, not a calculation
* legacy jsonb framework graphs are not migrated; they remain readable and
  unmapped, and a researcher maps them deliberately or not at all
* the framework has no visual diagram. The list is the interface at every
  width

New to this phase, and deliberate:

* **the browser suite is not in CI.** It needs a built app, a Supabase stack
  and a real Chrome. §53 says not to add a browser matrix the project cannot
  sustain, so it stays a local gate — and this document says so rather than
  letting a reader assume CI covers it.
* **the performance budgets are local measurements.** They were taken on one
  laptop against Docker Postgres. They will catch a plan regression; they are
  not a statement about production latency, and there is no production
  deployment to measure.
* **operational events have one sink, `console`.** That is a structured line
  on stdout, which every hosting platform collects, and `setEventSink` is the
  seam for anything else. Nothing aggregates or alerts on them yet.
* **the event vocabulary is wired into three routes**, not all of them —
  source search, the framework reorder and the construct trace. The vocabulary
  and its guarantees are the deliverable; extending the call sites is
  mechanical.
* **`ConstructPanel` takes `projectId` optionally**, so callers that only
  exercise editing keep working. Without it the traceability panel is simply
  not offered.
* **the 200 ms budget is a ceiling, not a target.** Every measured query is an
  order of magnitude inside it, so the budgets will catch a collapse and not a
  gradual drift.

---

## 15. Deferred work

* live AI benchmark comparison (`ai:benchmark:compare`)
* a stored per-hypothesis analysis result, which would make
  `result_traceability` computable
* a diagram view alongside the framework list
* AI-proposed framework relationships surfaced as reviewable suggestions
* per-author entities, and ORCID persistence
* running the browser suite in CI, if the project ever wants to pay for it
* extending the operational event vocabulary to the remaining routes, and
  pointing the sink at something that aggregates
