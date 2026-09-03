# Phase 20 — Research Intelligence Validation, Conceptual Framework & Production Verification

**Status: COMPLETE.** 1499 tests across 135 files (was 1340 across 127 at the
close of Phase 19, tip `84ae9fd`), plus a 45-test real-browser suite. Lint,
typecheck, build and the offline dry benchmark pass.

**RLS isolation: EXECUTED.** All five suites — Phase 17, 17B, 18, 19 and 20 —
were run against real local Postgres and pass. Phase 19's suite had never been
executed; running it was one of this phase's required gates and it passed
unmodified. See §12.

**Real-browser verification: EXECUTED.** 45 Playwright tests against
`next start` on the production build, driving the system Chrome. It found two
real defects on its first run. See §10.

**Live AI benchmark: DEFERRED**, as in every phase since 16B. **0 live Gemini
calls, 0 live OpenAI calls** were made building this phase.

---

## 1. Scope

Phase 20 answers one question, from either end:

> Show me exactly how this part of my research connects to the rest of the
> study, what supports it, what conflicts with it, and what still requires my
> judgement.

The subsystems already existed. Phase 17/17B built
Source → Evidence → Claim → Citation → Section. Phase 18 built
Question → Objective → Construct → Indicator → Item, and Hypothesis across it.
Phase 19 connected a claim to the methodology and added the integrity review.
What none of them had was a conceptual framework anyone could edit, a check
that spans all of them, or a single verified statement that the interface works
in a browser.

---

## 2. Architecture audit (20A), before any code

The audit found one thing that changed the shape of the phase.

**The conceptual framework was not "free-text labels needing canonical
constructs" — it was unreachable code.** `research_frameworks` (Phase 17) holds
one jsonb `graph` per project. Searching the whole tree for it found:

* no API route
* no `src/lib/db` module
* no component
* `validateFramework()` in `src/lib/evidence/framework-validation.ts`
  reachable **only from its own test file**

So the "conceptual framework editor" listed as an open gap in the roadmap since
Phase 16 had no model behind it in production either. The only conceptual
framework a researcher actually had was prose in the `conceptual_framework`
section.

That made the choice in §5 of the brief — "do NOT create a new graph model if
an existing one can be evolved safely" — a different question than it looked.
Evolving a jsonb blob cannot satisfy §30's requirement that the isolation gate
verify *framework isolation* and *cross-project composite foreign keys*, and
cannot hold the hypothesis link §7 puts on a relationship. So the framework was
promoted to relational tables, and the legacy jsonb table was left completely
untouched (§40).

What was reused rather than rebuilt:

| Reused | Where |
| --- | --- |
| `authorizeProject` preamble | every new route |
| `collectionRoute` / `itemRoute` | all four framework routes |
| `methodology_events` audit log | framework actions (§41) |
| `MethodologyModel` + `loadMethodologyModel` | framework checks, cross-system review |
| `runConsistencyChecks` (Phase 18) | cross-system review, via an adapter |
| `buildIntegrityFindings` (Phase 19) | cross-system review, via an adapter |
| `locateClaim` (Phase 17B) | inline claim location |
| `traceClaimNumbers` (Phase 19) | analysis traceability |
| `computeCoverage`, `computeCitationFunnel` | unchanged |

No canonical model was duplicated. No finding is stored.

---

## 3. Canonical conceptual framework (20B)

`research_framework_nodes` and `research_framework_relationships`, in
`20260902000000_phase20_conceptual_framework.sql`.

**A node has no `role` column.** The role a concept plays is on
`research_constructs`; copying it onto the node would let the two disagree
about what the study says, which is the second source of truth §2.3 forbids.
Role is read through `construct_id`.

**A node has two honest states**, and the check constraint
`research_framework_nodes_identifiable` requires one of them:

* `construct_id` set — canonical and checkable
* `construct_id` null, `label` set — unmapped, awaiting a researcher decision

`label` survives beside a linked construct so mapping a legacy node does not
lose its original wording, but `resolveNodes()` reads the construct's name
whenever one is linked. There is a test that a mapped node with stale wording
still displays the construct's current name.

**Nothing maps a legacy label automatically.** §40, and there is a test
asserting that a free-text label *identical* to a construct's name is still
reported as unmapped. Matching them by string is the invented mapping the brief
forbids; the interface offers the link and the researcher makes it.

### Relationship semantics (§7)

`relation_type` is constrained to exactly six words: `predicts`, `influences`,
`mediates`, `moderates`, `associated_with`, `supports`. Each corresponds to
something Phase 18 can already justify — `mediates`/`moderates` to construct
roles it stores, `predicts`/`influences` to directional hypotheses. Nothing
richer, per §7's warning against a vocabulary the methodology model cannot
support.

`hypothesis_id` is on the **relationship**, not on either node, because a
hypothesis is a statement about a *pair* of constructs. Same shape as
`research_hypothesis_variables` (position held by the link) and
`research_claim_evidence` (support held by the link).

### What the database refuses, so the engine does not check it

§9 lists things to detect. Four of them are better prevented:

| §9 item | Answered by |
| --- | --- |
| self-referential relationship | `check (from_node_id <> to_node_id)` |
| duplicate relationship | unique index on `(project_id, from, to, relation_type)` |
| duplicate construct node | partial unique index on `(project_id, construct_id)` |
| dangling relationship | composite FK, `on delete cascade` |

`validation.ts` deliberately does not scan for any of them — a check that can
never fire is a check nobody maintains, and each is attempted in the isolation
suite so the claim is tested rather than asserted. Differently *typed* edges
over the same pair are allowed: they say different things. Any number of
*unmapped* nodes may share a label: two legacy boxes both reading "motivation"
are an ambiguity for the researcher, and the database has no basis to call them
the same thing.

### Deletion behaviour

Argued in the migration and executed in the isolation suite:

* deleting a **construct** leaves its framework node, unmapped — the node
  survives with its position and relationships, and a `before delete` trigger
  fills its label from the construct so it stays recognisable
* deleting a **hypothesis** leaves the relationship and merely unlinks it, so
  the researcher sees a relationship that lost its justification rather than a
  diagram that quietly changed shape
* deleting a **node** removes its relationships — a relationship whose endpoint
  is gone is the dangling edge §9 wants prevented, and the audit log keeps the
  record

---

## 4. Framework ↔ methodology synchronisation (20C)

`src/lib/framework/validation.ts`. Pure; nothing touches the database.

| Check | Severity | Notes |
| --- | --- | --- |
| node names no construct | warning | the honest form of §8's "orphan node" — a real FK means a node *cannot* point at a deleted construct, so what occurs is the link being cleared or never made |
| construct with a role absent from the framework | warning | `latent` excluded: Phase 18 defines it as "not yet placed in the design" |
| hypothesis's two constructs drawn but unconnected | warning | |
| framework and hypothesis disagree on direction | warning | only for the five directional relation types; `associated_with` claims no direction and so contradicts nothing |
| relationship names a deleted hypothesis | warning | the state `on delete set null` actually produces |
| framework construct nothing measures | warning | counts both direct and via-indicator item mappings |
| framework construct in no hypothesis | info | descriptive studies legitimately have these |
| node connected to nothing | info | suppressed for a single-node framework |

**Nothing is ever rewritten.** A direction disagreement is between two things
the researcher wrote, and the system has no basis to decide which is the
mistake. No framework finding is ever `error`, and there is a test for that.

A hypothesis that does not yet name both ends is Phase 18's finding to report,
not this one's — saying it again would double-report one gap in two workspaces.

---

## 5. The cross-system review (20F)

`src/lib/review/`. `ResearchSystemReview` is §21's contract, recomputed on
every call and never stored.

```
ResearchSystemReview
├── metrics   ReviewMetric[]   value: number | null   (null = not computable)
├── findings  ReviewFinding[]  severity + provenance + target + relatedTo
└── generatedAt
```

It composes rather than re-implements: Phase 18's engine and Phase 19's review
are called and their findings re-labelled by `adapters.ts` into §22's nine
categories. Only three things are computed here that neither can see — the
framework checks, `cross-system.ts`'s edges *between* subsystems, and
`analysis-traceability.ts`.

`cross-system.ts` is deliberately narrow. Each check documents which existing
engine it is careful not to overlap:

* **evidence that supports nothing** — Phase 19 reports a *source* nobody
  cites; this is the step after, where the source is cited, an excerpt was
  pulled, and no claim was ever attached. `info`: collecting evidence before
  writing the sentence is ordinary practice.
* **a results/discussion/conclusion claim linked to no methodology node** —
  the study reports something the model does not account for.

`ReviewFinding.relatedTo` carries the other end of an edge, so §20's "identify
the exact broken edge" can name both objects without inventing a joined
pseudo-object.

### Severity discipline (§23)

`error` is a deterministic structural failure. `warning` is a possible
inconsistency. `info` is an opportunity. An `ai_suggested` finding is never
emitted as `error`, and nothing promotes a suggestion to `deterministic` after
the fact — asserted in tests, not merely documented.

### No composite score (§44)

`ResearchReviewWorkspace` renders category metrics with a ten-cell bar and the
reason behind each one. There is no "Academic Quality: 94/100", and tests
assert its absence in both jsdom and a real browser. A composite is the one
number a researcher would remember and the one number that means nothing: it
averages a broken citation with an unwritten operational definition.

A `null` metric renders as **"Not computable"** with **no bar at all** — an
empty bar reads as zero, and "no constructs, therefore 0% coverage" is a lie
about an empty project.

---

## 6. Inline traceability (20D)

Phase 19 could navigate to a section. §13 asks for the sentence.

`src/lib/integrity/claim-location.ts` returns `located`, `claim_not_located` or
`section_empty`. It runs against the section's **current** text from the
editor, never the snapshot the claim was extracted from — asking "is this
sentence still here" of a stale copy always answers yes.

**Offsets are checked before text search, which was not the obvious order.**
Because `locateClaim` normalises whitespace, any span an offset could verify is
also findable by text, which makes offsets look redundant. They are not, in one
case: a sentence appearing twice. Text search returns the first occurrence; the
offsets say which one the claim came from, and highlighting the wrong identical
sentence quietly puts the researcher in the wrong paragraph. Offsets only ever
*propose* a span — the claim text confirms it — so a drifted offset is refused
rather than believed. There is a test that no span is ever returned whose text
is not the claim.

`SectionEditor` focuses before `setSelectionRange` (a selection in an unfocused
textarea is invisible in every browser) and scrolls the line into view, which a
textarea will not do for a programmatic selection.

When the sentence is gone, `ProjectWorkspace` shows it: *"Could not highlight
that sentence — it has been edited or removed since the claim was extracted."*
A button that silently does nothing reads as broken, and the reason is
information the researcher needs before trusting other findings about that
claim. Verified in a real browser, both directions.

---

## 7. Reverse traversal (§16)

Both directions work off the same stored links:

```
Claim → Citation → Evidence → Source          Phase 19, unchanged
Source → Evidence → Claims                    literature workspace
Construct → Hypotheses → Items → Claims       methodology + review
Hypothesis → Claims                           analysis-traceability (new)
Framework node → Construct → everything       framework workspace
```

---

## 8. Source search and filter (20E)

`20260902000200_phase20_source_search.sql` plus
`GET /api/research/projects/:id/sources/search`.

Server-side, paginated, and filterable on title, author, year range, source
type, citation key, DOI, PMID, ISBN, theme, evidence-linked and cited/uncited.
The whole library never reaches the browser — the gap open since Phase 17B.

Indexes are justified by the queries that exist, not added speculatively (§18).
Empty states say *"No sources match the current filters"* — absence from this
project's library, never absence from the world (§19).

---

## 9. Analysis traceability (20G)

§24 asks whether structured result objects exist and says: if not, do not
fabricate them. **They do not.** The project stores parsed datasets and
`analysis_method` as free text per hypothesis; descriptive statistics are
computed on demand and never persisted. Nothing records "H1 was tested with a
Pearson correlation and r = .42".

So `result_traceability` is a metric that is `not_computable` in every project
and says exactly why. This is deliberate: 0% would read as "none of your
results are traceable", and omitting the category would hide that the check
does not exist. A test asserts the module's entire output contains no p-value,
no significance verdict and no confidence interval.

Two edges that *are* deterministic, and were not previously reported:

* **a number naming no dataset column.** Phase 19 only raises a finding for
  `inconsistent` — a number that matched a column and disagreed. `untraceable`
  produced nothing. `info`, and worded as the tool's failure to find the column
  rather than a defect in the thesis, because the match is a name heuristic. It
  cannot fire with no dataset linked, where every mention is `not_computable`.
* **a hypothesis no claim reports on.** §16's reverse traversal, which neither
  engine walks: Phase 18 checks a hypothesis has an analysis method, Phase 19
  checks a claim is linked to methodology, and nobody asked whether a stated
  hypothesis ever got answered. Invisible from either end. Suppressed until the
  results chapter exists; a link from a literature-review claim does not count.

---

## 10. Real-browser verification (20H) — EXECUTED

Every phase since 17B recorded that jsdom does not evaluate Tailwind
breakpoints, so their responsive claims were verified by reading class names.
Reading `sm:hidden` tells you the class is present, not that the element is
hidden, that the page does not scroll sideways, or that a control can be
tapped.

**Harness:** Playwright driving the **system Chrome** via `channel: "chrome"`.
Playwright's bundled Chromium has no macOS 13 build, which is this
environment's platform; the installed Chrome is still a real engine running
real layout. It runs against `next start` on the **production build**, not
`next dev` — a responsive gate that only passes in dev is worth nothing. Kept
out of `npm test` (`npm run test:browser`): Vitest and Playwright both export
`test`, and mixing them makes the fast suite slow and its failures ambiguous.

The fixture project is seeded through the service-role client and is
deliberately *not* clean — a construct outside the framework, an unmapped
legacy node, an unsupported claim — so a panel that silently renders nothing
cannot pass by looking tidy. Sign-in goes through the real login form, because
a suite that fabricates its own session keeps passing after auth breaks.

Assertions are behavioural, not screenshots (§27): a screenshot diff goes red
on a font change and green on a button nobody can tap.

**Verified at 320 / 375 / 414 / 768 / 1280:** no horizontal overflow on the
workspace or any overlay; editor geometry; every overlay's dismiss control on
screen; no duplicate ids in *both* the stacked and side-by-side layouts; tab
reachability; focus actually visible (outline **or** box-shadow — Tailwind's
focus ring is the latter, so checking outline alone reports every control in
this codebase as invisible); the framework readable as text at 320px; adding a
relationship surviving a reload; a finding selecting the exact sentence; and
`claim_not_located` being shown.

### Two real defects it found

**1. The editor collapsed at every width, desktop included.**
`WorkspacePanes` rendered each tabpanel as `display: block`, and every pane
sizes itself with `flex-1` — which does nothing inside a block parent. The
editor was a **72px** textarea in an **827px** column. §28 requires the editor
to remain primary on desktop; it was not. Panels are now flex columns and the
editor measures 659px in the same space.

**2. All four overlays were invisible to a keyboard.** They were `fixed
inset-0` divs: visually covering the workspace, and for tab order not existing.
Reaching the first control inside an open overlay took more than twenty-five
presses through the page behind it, and tabbing off the last one landed
silently underneath. `useDialogOverlay` gives all four `role="dialog"`,
`aria-modal`, focus entry, a focus trap, focus restoration to the opener, and
Escape to close.

A third, smaller finding came from a test failing to address a control: a
`<label>` wrapping a `<select>` folds the selected option's text into the
accessible name, so a row announced as "Relationship predicts" instead of
"Relationship". The framework forms use explicit `htmlFor`.

---

## 11. Accessibility (§33)

* dialog semantics and focus restoration on all four overlays — §10 above
* the conceptual framework is a **list at every width**, not a canvas. §33
  forbids a mouse-only graph and §34 forbids forcing a desktop diagram onto a
  phone; a canvas satisfies neither without a second keyboard-driven
  representation beside it, which is two interfaces over one model and they
  drift. Coordinates are still stored and still presentation-only.
* every select has an accessible name, asserted by iterating them in a test
  rather than by inspection
* no duplicate ids, verified in a real browser in both layouts
* tablists keep the roving-tabindex pattern Phase 17B established

---

## 12. Database and RLS (20I) — EXECUTED

Docker Desktop was present but paused, and the `docker` CLI was not on the
shell's PATH — which is why Phase 19 recorded "no Docker available". Both were
recoverable. The Phase 19 migration had also never been applied locally.

All five suites run against real local Postgres and pass:

| Suite | Result |
| --- | --- |
| `npm run db:verify:isolation` (17) | PASS |
| `npm run db:verify:isolation:17b` | PASS |
| `npm run db:verify:isolation:18` | PASS |
| `npm run db:verify:isolation:19` | **PASS — first execution**, unmodified |
| `npm run db:verify:isolation:20` | PASS |

The Phase 20 suite covers reads, cross-project references through every new
composite FK, writes into another project, blocked updates and deletes counted
by row count, the append-only audit trail, the §9 structural constraints, the
deletion behaviour in §3, and an owner positive control.

### The bug the Phase 20 gate found

Its deletion checks failed immediately, and not on Phase 20's own tables.

**A composite `on delete set null` foreign key nulls *every* referencing
column, `project_id` included — and `project_id` is `not null` on all of these
tables.** So the cascade did not unlink the child; the parent delete failed
outright with `null value in column "project_id" ... violates not-null
constraint`.

Ten constraints were affected across Phases 17, 18 and 20. Before
`20260902000100_phase20_composite_fk_set_null_repair.sql`, all of these
returned a 500:

* deleting a research question with an objective attached
* deleting an objective or question referenced by a hypothesis
* deleting a construct, indicator, scale or source referenced by a
  questionnaire item
* deleting a document with evidence extracted from it

Every one is an ordinary thing a researcher does. The earlier isolation suites
could not catch it because they check that a *stranger* cannot delete a row —
which RLS blocks before any cascade runs. Nobody had tested the owner deleting
their own row while a child pointed at it. The fix is the column list
(`on delete set null (construct_id)`), supported since PostgreSQL 15, and the
Phase 20 suite now regression-tests all ten.

---

## 13. Security (§37, §38)

Every new route: `authenticate → authorizeProject → Zod → business logic`, via
the shared `collectionRoute`/`itemRoute` helpers rather than a twelfth copy of
the preamble that could drift. Writes filter on `project_id`, so a
cross-project update is a zero-row result rather than a successful edit.
404 for a project that is not the caller's — identical to one that does not
exist, so a probe learns nothing (§38).

**Referenced ids are validated by the database, deliberately.** The framework
routes do not check that `constructId` belongs to the project in application
code: the composite FK refuses it, and the isolation suite proves it with a
real cross-project insert. An application check as well would read as the real
defence and quietly become the one people maintain.

No new AI surface was added, so no new rate-limit path. The existing
prompt-injection fixtures are unchanged and still pass.

---

## 14. Performance (§31, §32)

The cross-system review is the one view spanning every subsystem, so it is the
most tempting thing in the codebase to cache. **It is not cached.** §32:
correctness beats hit rate for derived findings, and a stale cross-system
finding tells a researcher their study is consistent after they have just
broken it.

The N+1 that mattered was avoided rather than found later: the methodology
model is loaded **once** and handed to the framework checks, Phase 18's engine
and Phase 19's builders. Letting each load its own would have been simpler code
and would have doubled every methodology query per review. `runAnalysisChecks`
adds no query — the datasets were already loaded for Phase 19's numerical
checks.

Source search is paginated and field-selective; nothing loads the library into
the browser.

---

## 15. Observability (§35, §36)

Framework actions record to `methodology_events` through the shared CRUD
helper — `created`, `updated`, `deleted`, plus `mapped`/`unmapped`, under the
two new entity types `framework_node` and `framework_relationship`. Reused
rather than given a second log: a researcher reconstructing one afternoon's
decisions should not have to look in two places. Still append-only — Phase 18's
explicit `revoke` covers the new entity types, and the isolation suite checks
it.

Events carry ids and bounded metadata. No source full text, no manuscript
contents, no prompts, no credentials.

---

## 16. AI boundaries (§2.2, §11, §23)

Phase 20 adds **no new AI capability**, which is the correct answer to a phase
about validation. The framework can be proposed by AI through the existing
provenance vocabulary — a node or relationship inserted with
`provenance: 'ai_suggested'` and `confirmed: false` is visible, marked and
awaiting a decision — but nothing in this phase creates one automatically, and
no route accepts an AI-authored framework.

AI still cannot verify a citation, certify evidence, certify methodology,
declare plagiarism, or call a source truthful. `ReviewFinding.provenance`
separates a fact about stored rows from a proposal, the UI renders them
differently, and nothing promotes a suggestion to `deterministic`.

**0 live Gemini calls, 0 live OpenAI calls.**

---

## 17. Tests

| | Phase 19 | Phase 20 |
| --- | --- | --- |
| Vitest tests | 1340 | 1499 |
| Vitest files | 127 | 135 |
| Browser tests | 0 | 45 |
| Isolation suites executed | 3 of 4 | 5 of 5 |

New coverage: the canonical framework model and its checks; framework ↔
methodology synchronisation including direction disagreement; claim location
including every offset failure mode; the cross-system review and its adapters;
analysis traceability and its refusal to invent statistics; the four framework
routes including cross-project rejection; source search and filtering; the
framework and review workspaces; dialog semantics; and the real-browser suite.

---

## 18. Known limitations

Carried forward, still true:

* **the live AI benchmark remains deferred** — provider billing credit is the
  only blocker
* external source verification is not source truth; a resolvable DOI says a
  record exists, not that it says what the claim says
* semantic conflict detection is advisory
* linguistic item checks are heuristics
* numerical traceability matches a claimed number to a dataset column by a
  word-boundary name match — a heuristic, not a proof
* unsupported claims may exist outside the modelled claim set
* ORCID is validated but not persisted; no per-author entity exists

New to this phase, and deliberate:

* **no structured per-hypothesis result is stored**, so
  `result_traceability` is permanently `not_computable`. Closing it is a schema
  change, not a calculation.
* **legacy jsonb framework graphs are not migrated.** They remain readable in
  `research_frameworks` and unmapped; a researcher maps them deliberately or
  not at all.
* **the framework has no visual diagram.** The list is the interface at every
  width. A canvas would need a second keyboard-accessible representation
  beside it.
* **framework layout coordinates are stored but not yet editable** through the
  interface. They are presentation-only and nothing reads them.
* **browser verification is environment-dependent.** It needs a local Supabase
  stack and an installed Chrome; the bundled Chromium has no macOS 13 build.
* **`npm run ai:benchmark:dry` overwrites `reports/ai-benchmark/latest.*`**
  with a mocked report. The committed file is a real LIVE provider run from
  Phase 16, so the dry gate destroys it as a side effect and the overwrite must
  be discarded rather than committed. Worth making the dry run write elsewhere.
* the `supabase_migrations` history table was already out of step with the
  applied schema before this phase (Phase 16/17 rows missing while their
  objects existed). Phase 19 and 20 rows were recorded as applied; the older
  drift was left alone rather than rewritten.

---

## 19. Deferred work

* live AI benchmark comparison (`ai:benchmark:compare`)
* a stored per-hypothesis analysis result, which would make
  `result_traceability` computable and enable §25's results ↔ manuscript
  contradiction check deterministically
* researcher-editable framework layout, and a diagram view alongside the list
* AI-proposed framework relationships surfaced as reviewable suggestions
* per-author entities, and ORCID persistence

---

## 20. Release gate

| Gate | Result |
| --- | --- |
| `npm test` | 1499 / 135 files, pass |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npm run ai:benchmark:dry` | pass |
| `npm run test:browser` | 45 pass |
| Phase 17 isolation | PASS (executed) |
| Phase 17B isolation | PASS (executed) |
| Phase 18 isolation | PASS (executed) |
| Phase 19 isolation | PASS (executed, first time) |
| Phase 20 isolation | PASS (executed) |
| Live Gemini calls | 0 |
| Live OpenAI calls | 0 |
