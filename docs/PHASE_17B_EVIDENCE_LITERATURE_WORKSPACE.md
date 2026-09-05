# Phase 17B — Researcher-Facing Evidence & Literature Workspace

**Status: COMPLETE.** 935 tests across 94 files (was 770 across 73 at phase
start), lint, typecheck, build and the offline dry benchmark all pass. 16/16
real-Postgres isolation checks pass for the new tables, and the Phase 17 suite
still passes 8/8.

**Live AI benchmark: DEFERRED.** No paid provider call was made in this phase.
Every AI-dependent path is exercised through the deterministic mock provider,
offline fixtures and an injected retrieval port.

Phase 17 built the *model*: the Source → Evidence → Claim → Citation → Section
chain, the deterministic review logic, and two components that were tested but
never mounted. Phase 17B is the half a researcher can actually touch — the
panes, the workflows that write those rows, and the four literature surfaces
that operate across sources rather than inside one section.

---

## 1. What the researcher can now do

| Workflow | Entry point | What it writes |
| --- | --- | --- |
| See a section's health | Review pane, beside the editor | nothing — it recounts rows |
| Extract claims from a passage | Editor → *Find evidence for selection* | `research_claims` |
| Find evidence for a claim | Evidence pane → *Find evidence* | nothing until inserted |
| Insert evidence into the text | Evidence pane → preview → *Insert* | evidence, relation, section, version |
| Inspect and restore history | History pane | a **new** version row |
| Group sources into themes | Literature → Themes | `research_themes`, `research_theme_sources` |
| Compare sources field by field | Literature → Compare | `research_source_profiles` |
| Record where the literature stops | Literature → Research Gaps | `research_gaps` |

## 2. Section review contract (§3–§5)

`SectionReview` is one normalized shape — four `ReviewMetric`s (completeness,
evidence coverage, alignment, citation integrity) plus issues and a coverage
count — produced by `buildSectionReview()` in
`src/lib/evidence/section-review-service.ts` and rendered by
`SectionReviewPanel`, which fetches nothing itself.

A `ReviewMetric` carries `value: number | null` alongside its label and
explanation. `null` is a first-class result, not a zero: where a dimension is
not computable the bar is absent and the reason is shown, because a plausible
number standing in for a missing one is the failure mode this panel exists to
avoid.

**Minimal fetching (§5).** The review loads this section, this section's
claims, only the prior sections the context policy names, and only the
citations whose keys actually appear in this section's text. Nothing loads the
whole project.

## 3. Version history and restore (§6–§8)

`restoreSectionVersion` writes the **section first**, then records a version
with action `restore`. The order matters: a version row claiming a change that
never reached the section is a history that lies. Restore never deletes — it
appends, and the UI says so in those words.

`research_section_versions.action` gained `evidence_insert`, deliberately
distinct from `insert` (§29). An evidence insertion is the researcher choosing
a source and the app placing a citation; labelling that "AI insert" would
misreport the one thing the history exists to keep straight.

## 4. Claims (§11–§12)

`extractClaims()` sends only the selected passage — never the section, never
the project. Extracted claims come back as *proposals*: they are rendered
editable and nothing is persisted until the researcher saves them.

`needsEvidence` is **never taken from the model**. The model classifies the
claim's type; `claimNeedsEvidence` derives whether it needs evidence, so the
one field that drives coverage arithmetic is deterministic. Character offsets
are best-effort (verbatim `indexOf`) and treated as a convenience, not a
guarantee.

## 5. Evidence search and ranking (§13–§14)

Search reuses the existing RAG path — `embedQuery` + the
`match_document_chunks` RPC — through a `RetrievalPort`. There is no second
vector store and no second index. The port's default implementation *is* the
real path; tests inject a deterministic retriever, which is how this phase
covers retrieval without spending a credit on an embedding call.

Ranking (`src/lib/evidence/ranking.ts`):

```
topicalRelevance = 0.65 · semantic + 0.35 · lexicalOverlap
score            = topicalRelevance · (1 + qualityBonus + contextBonus)
```

Source quality is a **multiplier capped at +25%**, and a `RELEVANCE_FLOOR` of
0.12 turns the multiplier off entirely below it. That is §14 stated in code: a
peer-reviewed, recent, highly-rated source that does not address the claim
sorts *after* every on-topic candidate and says why, because quality that can
outrank relevance is how a well-cited irrelevance gets into a thesis.

Outcomes are explicit: `ok`, `no_evidence_found`, `retrieval_failed`. The last
two are different states and are shown differently — "nothing in your library
matches" is a finding; "the search failed" is not.

## 6. Insertion (§15–§19)

Three modes, all previewed before anything is written:

| Mode | Effect on the text |
| --- | --- |
| `citation_only` | places `[key]` before the sentence's terminal punctuation |
| `evidence_citation` | inserts the excerpt with the citation |
| `replace_claim` | replaces the located claim with the researcher's replacement text |

`replace_claim` stays disabled until replacement text is typed. Support
(`SUPPORTED` / `PARTIAL` / `CONTRADICTS` / `NEEDS_REVIEW`) is required on the
API with **no default**, because a silent default would be the app forming the
judgement the researcher is supposed to form.

`insertEvidence()` re-resolves the claim and the citation *inside the project*
before touching anything, then creates the evidence row, the
claim↔evidence relation carrying the support label, the edited section, the
`evidence_insert` version, and a refreshed claim status. Placement is pure and
separately tested (`citation-insertion.ts`, whitespace-tolerant index map);
outcomes are `placed`, `already_present`, `claim_not_located`.

Post-insert validation is deterministic (§19): the text is re-read and the
relation re-counted. `explainSectionCitations()` resolves
Section → Claim → Evidence → Source → Citation so every bracket in the section
can be traced to the excerpt behind it.

## 7. Source comparison (§20–§21)

`research_source_profiles` holds one row per source with **every field
nullable**. Null renders as the literal string `Not available in source` — a
comparison table that fills a blank cell with a plausible sentence is worse
than one with a visible gap, because the reader cannot tell which is which.

`field_provenance` records per field whether the text was `source_stated` or
`ai_inference`, so an inference can never be read back as a source fact.
Cross-source statements must name the sources they rest on; a statement whose
keys do not resolve to sources in the comparison is dropped rather than shown
unattributed. Two to five sources at a time.

## 8. Themes (§22)

`suggestThemes()` returns proposals and **writes nothing**. Suggested themes
carry `ai_suggested` and are labelled `AI SUGGESTED` in the UI until the
researcher confirms them; the flag survives renaming and re-assignment, so
provenance is not lost the first time the list is tidied. Citation keys the
model invents are dropped. Fewer than two sources is a no-op — there is no
grouping to propose.

## 9. Research gap matrix (§23–§24)

Every gap carries a `basis`: `source_stated`, `derived_limitation`,
`ai_inference`, `user_observation`, `needs_verification`. A gap a paper states
in its own future-work paragraph and a gap a model inferred from a small
sample are both useful and are not the same claim.

The model's claimed basis is not trusted. `quoteIsGrounded()` checks the
supporting quote against the stored profile text (≥0.8 content-word overlap);
an ungrounded `source_stated` or `derived_limitation` is **downgraded** to
`ai_inference` and the downgrade is surfaced. `verified` is always false on
creation and can never be set through the suggestion path. The database
enforces the other half: `research_gaps_stated_needs_source` rejects a
`source_stated` gap that names no source.

## 10. Section ↔ literature integration (§27–§29)

The Literature workspace opens as a full-screen overlay **over** the editor
rather than as a route, so closing it returns the researcher to the same
paragraph — the editor never unmounted. A review issue's *Find evidence*
switches the aside to the Evidence pane with the claim already loaded; a
citation issue opens Literature on Sources.

Evidence coverage after an insertion is recomputed from stored relations, not
reported by the insertion. The end-to-end test asserts coverage moving 0 → 0.5
purely because rows changed.

## 11. Mobile and responsive layout (§30)

One DOM tree. Panes render **once** and only their visibility is responsive;
there is no mobile layout beside a desktop layout, because that duplicates
every interactive control and every `id` inside the panes.

- **≥ lg:** three columns — Navigator | Editor | aside, with Review / Evidence
  / AI Assist / History as an inner tab group in the aside.
- **< lg:** one tab row — Sections → Editor → Review → Evidence → AI Assist →
  History. The row scrolls horizontally rather than wrapping, so the six labels
  fit at 320 px without reflowing the panes.

The breakpoint itself is Tailwind's `lg`, applied once in `WorkspacePanes`.
What the DOM tests assert is the part that can be asserted headlessly: that
each pane exists exactly once, that the mobile tablist selects it, and that
switching away and back preserves its state. jsdom does not evaluate the
responsive classes, so the *visual* result at 320 / 375 / 414 px and tablet
width has not been checked in a real browser — see §14.

Panes stay mounted across tab switches, so editor text, a pending AI
suggestion and a half-finished evidence preview all survive. A test types into
the editor, switches tabs and returns to assert exactly that. Both tab rows
use the roving-tabindex pattern with arrow-key movement.

## 12. Security (§34–§35)

Every new route begins with `authorizeProject(projectId)`
(`src/lib/api/authorize.ts`): authenticate, resolve the project, confirm
ownership, and — for AI routes — apply the existing rate limit. Object ids in
the body are **re-resolved inside the project** before use; no route accepts an
id on the caller's word.

Document, evidence and source text stays untrusted throughout: it is passed as
data through the existing prompt-injection guard, never as instruction. A
regression fixture carries injection text through claim extraction and
comparison and asserts the instruction is not followed.

Database-level isolation is not left to the policies alone. Composite foreign
keys carry `project_id` into every reference, so a row cannot point at another
project's theme, source or citation even if a policy were written wrongly —
this is the hole Phase 17 found by testing, and the new tables were built with
it closed from the start.

## 13. Testing

| Area | Files |
| --- | --- |
| Deterministic logic | ranking, citation-insertion, section-review-service, insertion, evidence-search, claim-extraction, comparison, gap-analysis, theme-suggestions |
| DB layer | `src/lib/db/__tests__/literature.test.ts` |
| Routes | `src/app/api/__tests__/phase17b-routes.test.ts` — auth, ownership and cross-project rejection for every new endpoint |
| End-to-end | `src/lib/ai/__tests__/phase17b-evidence-workflow.e2e.test.ts` — passage → claims → search → insert → coverage, plus the injection fixture |
| Components | EvidenceCard, EvidenceInsertPreview, EvidencePanel, LiteratureWorkspace, ResearchGapMatrix, SourceComparison, ThemeManager, SectionReviewPane, SectionHistoryPane, SectionReviewPanel, WorkspacePanes, VersionHistory |
| Real Postgres | `supabase/tests/phase17b_project_isolation.sql` — `npm run db:verify:isolation:17b` |

AI-dependent tests run against the deterministic mock provider, which patches
the provider classes in place so the real orchestrator, router and guards still
execute. Offline AI provider calls in this phase: **0**.

## 14. Known limitations

- **Claim offsets drift.** Offsets are captured at extraction time by verbatim
  match. Editing the paragraph afterwards invalidates them; insertion re-locates
  the claim by text and reports `claim_not_located` rather than guessing.
- **Comparison is capped at five sources.** Wider comparisons would need a
  different presentation than a table a person can read.
- **Theme suggestion reads bibliographic lines only,** not full text, so it
  groups by what the bibliography says a source is about.
- **`research_claims.section_type` is text, not a foreign key,** matching the
  existing schema; section renames would need a migration.
- **Retrieval quality is inherited.** Ranking can only reorder what
  `match_document_chunks` returns; a source that was never chunked cannot be
  found.
- **Live benchmark still deferred.** Ranking weights and the relevance floor
  are validated against fixtures, not against live model output.
- **No real-browser layout pass.** The responsive structure is asserted in
  jsdom, which does not apply the Tailwind breakpoints. Confirming the rendered
  layout at 320 / 375 / 414 px needs an authenticated session against the local
  stack and was not done in this phase.
