# Phase 18 — Advanced Methodology & Questionnaire Intelligence

**Status: COMPLETE.** 1167 tests across 110 files (was 935 across 94 at phase
start). Lint, typecheck, build and the offline dry benchmark pass. 23 new
real-Postgres isolation checks pass, and the Phase 17 (8) and Phase 17B (16)
suites still pass unchanged.

**Live AI benchmark: DEFERRED.** No paid provider call was made in this phase.
0 Gemini calls, 0 OpenAI calls. Every AI-dependent path runs against the
deterministic mock provider.

---

## 1. Scope

Phase 18 builds the layer that connects

```
Research question → Objective → Construct → Hypothesis
                        → Indicator → Questionnaire item → Analysis plan
```

and reports where that chain is broken. It behaves like a methodology
*reviewer*: it does not design a study, and it does not certify one.

## 2. Existing architecture discovered

Recorded in full in `docs/PHASE_18_METHODOLOGY_AUDIT.md`, written before any
code. The finding that shaped everything is in the Phase 6 migration's own
header:

> Objectives/variables are NOT normalized into their own tables here — they
> still live as free text in research_sections. Each question maps to an
> objective/variable/construct as descriptive text (`objective_label` /
> `variable_label`), not a foreign key, because there is no structured
> objectives/variables entity to reference yet.

The questionnaire has been pointing at *strings* since Phase 6 because there was
nothing to point at. Every consistency question Phase 18 asks — "does this item
measure anything?", "is this construct measured at all?" — is unanswerable while
the target of the reference is a label a researcher retyped slightly
differently.

Two representations exist and must not become three:

| | Canonical for |
| --- | --- |
| Prose in `research_sections` | the document — what gets written and exported |
| Rows in the Phase 18 tables | reasoning — what the consistency engine reads |

Neither is derived from the other automatically. Parsing prose into constructs
would invent structure the researcher never approved; generating prose from
structure would overwrite writing. **`research_sections` is not read or written
by any Phase 18 code path except the analysis-plan text the §33 checks consult.**

## 3. Canonical model

```
research_questions ──< research_objectives
                            │
research_constructs ────────┘   (role: independent / dependent / mediator /
   │                             moderator / control / demographic / latent)
   ├──< research_indicators      (dimension is a column, not a table)
   │        └──< questionnaire_questions.indicator_id
   └──< questionnaire_questions.construct_id

research_hypotheses ──< research_hypothesis_variables >── research_constructs
research_scales ──< questionnaire_questions.scale_id
methodology_events   (append-only)
```

**One construct table, not constructs plus variables.** A construct is the
concept; a variable is the role it plays. Two tables would need a join for every
check and would give the app two names for one thing — the confusion the engine
exists to detect. `latent` is the role of a construct not yet placed.

**The hypothesis→construct link carries the position.** The same construct is
the outcome in H1 and the predictor in H2, so the position belongs to the
relationship. The identical argument put `support` on `research_claim_evidence`
in Phase 17.

**No findings table.** Findings are derived from rows on every request. A stored
finding is a second source of truth that goes stale the moment a construct is
renamed — the precedent `SectionReview` set in Phase 17B.

## 4. Database changes

`supabase/migrations/20260901130000_phase18_methodology_model.sql`

- New: `research_questions`, `research_objectives`, `research_constructs`,
  `research_indicators`, `research_hypotheses`,
  `research_hypothesis_variables`, `research_scales`, `methodology_events`.
- New enum `methodology_provenance` (`user` / `ai_suggested` / `source_stated` /
  `imported`) — the vocabulary the rest of the app already uses.
- `questionnaire_questions` gains `construct_id`, `indicator_id`, `scale_id`,
  `reverse_coded`, `item_provenance`, `source_citation_id`, `source_location`,
  `adaptation_type`, `updated_at`, plus a `(id, project_id)` unique key.
  **The existing `objective_label` / `variable_label` / `construct` text columns
  stay.** They are the mapping some projects already have.
- Check constraint `questionnaire_questions_adaptation_needs_source`: an item
  may not claim a source without naming one (§31).
- Every reference is a composite foreign key carrying `project_id`.
- `methodology_events` is append-only: `revoke update, delete, truncate`.

**Forward-safety.** The migration is additive. No existing row is read,
rewritten or deleted; the structured model starts empty for every existing
project, and an empty model produces `null` metrics rather than zeros.

## 5. Deterministic validation rules

All pure, in `src/lib/methodology/`, reading only stored rows.

| Area | Rules |
| --- | --- |
| Questions / objectives | question with no objective; objective with no question; no hypothesis traceable to a relational question |
| Constructs | near-duplicate names; missing conceptual definition; missing operational definition; no indicators; measured by nothing; unconfirmed AI suggestion |
| Indicators | no questionnaire item |
| Hypotheses | no linked constructs; no outcome; mediation with no mediator; moderation with no moderator; uses a construct nothing measures; not traceable to an objective or question; opposite directions for the same construct pair |
| Analysis plan | no method recorded; a relational hypothesis with a descriptive-only method |
| Items | unmapped; Likert with no scale; reverse-coded on an unordered scale; double-barrelled; leading wording; stacked negations; unclear reference; unconfirmed AI item |
| Item sets | redundancy within a construct; one construct on multiple scales; scales running in opposite directions |

Severity is disciplined. `error` is a state that cannot be acted on (a
hypothesis with no outcome, a construct measured by nothing). `warning` is a
started-but-unfinished link. `info` is a prompt to look. **Linguistic rules are
never `error`** — they are heuristics about natural language, and no pattern
match settles whether a respondent will misread an item; only a pilot does. Each
one says so in its own text.

Question classification returns `unclassified` as a real answer, and its reason
says that is a limit of the check rather than a judgement on the question (§6).

### Metrics (§14)

Nine named dimensions, no overall score. Each carries
`{ value: number | null, status, reason, evidence? }`. **`null` means "not
computable", never zero** — a project with no constructs has no construct
completeness to report, and a 0% bar would read as a failing study.

## 6. AI proposal architecture

Six workflows: item mapping, construct suggestion, hypothesis drafting, item
generation, item rewriting, operational-definition wording. All return proposals
and **write nothing**.

Three guarantees are in code rather than in the prompt, because a prompt is a
request:

1. **Ids are echoed, never invented.** Every id in a response is checked against
   the candidate list that was sent. The candidate list is built server-side
   from project-scoped queries and never from the request body — which makes a
   cross-project id *impossible* rather than merely detected: a caller cannot
   offer the model an id from another project because a caller cannot offer the
   model anything.
2. **Source provenance is not the model's to assert.** No workflow returns a
   citation id or adaptation type, and `POST /methodology/items` has no source
   field, so a generated item cannot arrive attributed to a published
   instrument. Attribution is a separate deliberate edit where the database
   enforces the pairing.
3. **Consequential fields are derived.** A question's shape is computed and told
   to the model rather than asked of it — letting the model both pick the shape
   and write to it removes the check. `hasOutcome` is recomputed from the links.

Every workflow shares one framing that forbids validity, reliability,
sufficiency and validation claims, and forbids attributing anything to a source.

### Context budget (§18)

`src/lib/methodology/context-budget.ts` declares, per workflow, the maximum text
length, candidate count, candidate label length and proposal cap. Truncation
cuts on a word boundary, marks the cut **in the prompt** so the model knows it is
reading a fragment, and returns `contextTruncated: true`, which the workspace
shows as a banner. Nothing is silently shortened.

## 7. Prompt-injection handling

Researcher, document and source text stays data. The existing
`RESEARCH_INTEGRITY_INSTRUCTIONS` rule that content under data headings is never
instruction is unchanged and still applies. Phase 18 adds a fixture
(`INJECTION_TEXT`) that asks the model to declare the instrument validated and
to attribute it to an author, carried through item generation both in a unit
test and in the end-to-end run. The assertion is structural rather than
behavioural: the proposal type has nowhere to carry a validation claim or a
citation, so the request cannot be honoured whatever the model does with it.

## 8. Provenance model

| Value | Means |
| --- | --- |
| `deterministic` (findings only) | a fact about stored rows |
| `user` | the researcher wrote it |
| `ai_suggested` | a model proposed it; a proposal, not a decision |
| `source_stated` | a source says so, and names the source |
| `imported` | came from an uploaded instrument |

`confirmed` is separate from `provenance` and is what a researcher's decision
writes. Provenance survives renaming and re-editing, so a construct that started
as a suggestion still says so after it is edited. The UI never renders a
deterministic finding and an AI-suggested one identically.

## 9. Questionnaire intelligence

Integrated into the existing builder, not a second questionnaire (§22). Opening
an instrument loads the constructs, indicators and scales; each item gains a
measurement-details editor. Changing an item's construct clears its indicator,
because an indicator under the old construct is a mapping that contradicts
itself. Only indicators under the chosen construct are offered.

The coverage matrix shows construct → dimension → indicator → item, plus
uncovered indicators and items that measure nothing. **It suggests no target
item count**: three-per-indicator is a convention from one measurement
tradition, not a fact, and printing it as a target would turn it into a
requirement the researcher never chose.

## 10. Security

Every methodology route runs `authorizeProject` (authenticate → resolve project
→ ownership → AI rate limit where applicable), validates its body with Zod
*before* the project lookup, and re-resolves every referenced id inside the
project. Ten CRUD routes share one implementation, because ten copies of a
preamble is ten chances for one to drift and the copy that forgets the ownership
check accepts any id from any user.

75 route tests cover 401 and 404 on every endpoint, that no database work
happens before authorisation, validation rejection, path ids re-resolved inside
the project, the rate limit on the AI route, the audit-log size cap and the
source-claim pairing.

## 11. RLS and isolation

`supabase/tests/phase18_project_isolation.sql` — `npm run db:verify:isolation:18`
— 23 checks against real Postgres: reads blocked on all eight tables,
cross-project references rejected on the composite foreign keys (objective→
question, indicator→construct, hypothesis→objective, hypothesis-variable,
item→construct, item→scale), writes into another project refused, updates and
deletes matching zero rows, the audit log refusing update and delete, the
source-claim check constraint, the owner's rows verified intact afterwards, and
a positive control that the second user can still work in their own project.

**A hole this suite found.** The Phase 3 migration set `alter default privileges
... grant select, insert, update, delete on tables to authenticated`, so every
table created since inherits UPDATE and DELETE. Granting only select and insert
on `methodology_events` therefore changed nothing, and its append-only property
was a comment rather than a rule. The write was in fact still blocked — there is
no update or delete policy, and RLS denies by default — but *silently*, as a
statement affecting no rows. The migration now revokes explicitly so the attempt
fails loudly: a barrier that looks like a successful no-op is a barrier nobody
notices has moved.

## 12. Testing

| Area | Files |
| --- | --- |
| Deterministic logic | `question-classification`, `questionnaire-quality`, `consistency`, `graph` (+ coverage) |
| AI workflows | `suggestions` — includes the §40 adversarial set |
| Routes | `src/app/api/__tests__/phase18-routes.test.ts` |
| End to end | `src/lib/methodology/__tests__/methodology-workflow.e2e.test.ts` |
| Components | MethodologyMetrics, MethodologyFindings, AISuggestionCard, CoverageMatrixView, MethodologyWorkspace, ItemMethodologyEditor, QuestionObjectivePanel, ConstructPanel, HypothesisPanel |
| Real Postgres | `supabase/tests/phase18_project_isolation.sql` |

The §40 adversarial fixtures: valid output, invalid JSON, missing fields, a
hallucinated construct id, a well-formed id from another project, injected
instructions, and an unsupported source claim.

The end-to-end run builds the whole chain, finds a coverage gap
deterministically, asks the mock provider for items, confirms nothing was
written by the proposal, accepts one, and re-runs the review — which derives
coverage 0.5 → 1 **from the rows that were written**, not from the response that
proposed them. Had accepting not created the item, the numbers would not move
and the test would fail with the model's answer having been perfectly good.

## 13. Performance

Reads are scoped and never load "the project". `GET /methodology` returns the
methodology model in one request — the workspace needs the edges as much as the
nodes, and eight round trips would render eight loading states for one screen —
but that model excludes section prose (beyond the analysis plan), sources,
evidence and history. History is paged newest-first and capped at 200. The
questionnaire builder loads the mapping options only when an instrument is
opened.

Every AI prompt sends one object plus its candidate list. An item mapping
prompt is under 2KB, asserted by a test.

## 14. Mobile and accessibility

One DOM tree. Every tab panel is rendered exactly once and hidden with `hidden`,
so no control and no `id` appears twice — asserted by a test. Both tab rows use
the roving-tabindex pattern with arrow-key movement and visible focus rings.
Metrics expose `role="meter"` with `aria-valuetext="not computable"` where the
value is null. Every input has a label; disclosure buttons carry
`aria-expanded`. The tab row scrolls horizontally rather than wrapping, so it
survives 320px.

**Structural responsive tests verified. Visual breakpoint verification remains
pending** — jsdom does not apply Tailwind's breakpoints, and confirming the
rendered layout at 320 / 375 / 414 px needs an authenticated session against the
local stack, which was not done in this phase.

## 15. Known limitations

- **Linguistic checks are heuristics.** Double-barrelled, leading, negation and
  ambiguity detection are pattern matches over natural language. They flag; they
  do not establish that an item is defective.
- **AI suggestions are not methodology certification.** Nothing here says a
  design, an instrument or a sample size is adequate.
- **Statistical compatibility is advisory.** One rule fires, on a definitional
  mismatch, and defers the judgement to the researcher.
- **Psychometric validity cannot be inferred without data.** The system reports
  structure — coverage, mapping, scale consistency, reverse-coding — and says
  when a structure is ready for a reliability analysis. It never reports that an
  instrument is reliable.
- **Source-based claims require actual source evidence.** No AI path can write
  provenance.
- **Duplicate-name detection is crude** — same content words, with a trailing
  "s" stripped. It catches "teacher motivation" / "motivation of teachers" and
  will miss a genuine synonym.
- **No real-browser visual verification** (see §14).
- **No live provider benchmark** — ranking of proposals, prompt wording and
  model behaviour are validated against fixtures, not live output.
- **The conceptual framework is not yet linked to constructs.** The canonical
  target now exists; `research_frameworks.graph` still stores free-text node
  labels. Deferred, with the integration point identified in the audit §8.

## 16. Deferred

- Live Gemini/OpenAI benchmark.
- Real-browser responsive verification.
- Conceptual-framework editor bound to canonical constructs.
- Source search/filter across a large library (carried from Phase 17).

## 17. Verification results

| Gate | Result |
| --- | --- |
| `npm test` | 1167 passed, 110 files |
| `npm run lint` | clean |
| `npm run typecheck` | clean |
| `npm run build` | succeeds |
| `npm run ai:benchmark:dry` | passes |
| `npm run db:verify:isolation` (Phase 17) | 8/8 |
| `npm run db:verify:isolation:17b` | 16/16 |
| `npm run db:verify:isolation:18` | 23/23 |
| Live provider calls | 0 |
