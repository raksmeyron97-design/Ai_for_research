# Phase 19 — Research Integrity, Citation Verification & Academic Quality

**Status: COMPLETE.** 1340 tests across 127 files (was 1234 across 119 at the
close of Phase 18, on branch `feat/phase-18-methodology-questionnaire-intelligence`
tip `c60ec0d`). Lint, typecheck and the offline dry benchmark pass.

**RLS isolation: written, not run.** `supabase/tests/phase19_project_isolation.sql`
and `npm run db:verify:isolation:19` exist and mirror the working Phase 17/17B/18
suites exactly, but no Docker/Postgres was available in the environment this
phase was built in, so the script has been reviewed by hand rather than executed.
Run it before merging.

**Live AI benchmark: DEFERRED**, same as every phase since 16B. **0 live Gemini
calls, 0 live OpenAI calls** were made building this phase. Every AI-dependent
path runs against the deterministic mock provider (`createMockProvider`/
`withMockProvider`).

---

## 1. Scope

Phase 19 builds the layer that answers:

> Can the claims in this research document be traced to evidence, citations,
> sources, and the methodology model the researcher actually approved?

It connects two chains Phases 17/17B and 18 already built but never joined:

```
Section → Claim → Citation → Evidence → Source           (Phase 17/17B)
Research Question → Objective → Construct → Hypothesis
    → Indicator → Questionnaire Item → Analysis Plan      (Phase 18)
```

It behaves like a research-integrity *assistant*, not an authority. It is
explicitly **not** a plagiarism detector, a misconduct classifier, an automatic
peer reviewer, a publication-acceptance predictor, or a "scientific truth"
engine — see §12 for the full non-goals list, which was fixed before any code
was written and did not move during implementation.

## 2. Existing architecture reused (audited before any code)

An architecture audit ran before Stage 1. Nothing it found needed a second
model — every table, type, and service below already existed and Phase 19
builds on it rather than beside it:

| Concern | Reused as-is | File |
| --- | --- | --- |
| Source / citation | `research_citations`, `ResearchCitationRow` | `src/lib/db/types.ts` |
| Claim / evidence / support | `research_claims`, `research_evidence`, `research_claim_evidence`, `SupportLabel` | `src/lib/db/types.ts` |
| Deterministic evidence status | `claimNeedsEvidence`, `deriveClaimStatus`, `computeCoverage` | `src/lib/evidence/status.ts` |
| Citation-key extraction | `extractCitationKeys`, `isCitationKeyShaped` | `src/lib/ai/integrity-guard.ts` |
| Retrieval | `RetrievalPort`, `createRetrievalPort`, `searchEvidenceForClaim` | `src/lib/evidence/evidence-search.ts` |
| Methodology graph | `research_questions` … `research_hypothesis_variables`, `MethodologyModel` | `src/lib/methodology/model.ts` |
| Consistency-engine shape | `runConsistencyChecks`, `MethodologyFinding`/`MethodologyMetric` contract, `normalisedName` (now exported) | `src/lib/methodology/consistency.ts` |
| AI orchestration | `AIOrchestrator`, `parseAIJson`, zod-schema-per-task, `propose()`/`keepKnownIds()` shape | `src/lib/ai/orchestrator.ts`, `src/lib/methodology/suggestions.ts` |
| Auth preamble | `authorizeProject`, `dbErrorResponse` | `src/lib/api/authorize.ts` |
| Audit-log shape | `methodology_events`'s structure (append-only, non-FK `entity_id`, explicit revoke) | `20260901130000_phase18_methodology_model.sql` |
| Workspace pattern | Overlay-over-the-editor, mounted-not-unmounted tabs | `MethodologyWorkspace.tsx`, `LiteratureWorkspace.tsx` |

No second claim model, no second citation model, no second vector search, no
second consistency ruleset, no second AI-proposal contract.

## 3. Canonical model

Three new tables, one new column pair on an existing table:

```
research_claims ──< research_claim_methodology_links >── one of:
                       research_constructs / research_hypotheses /
                       research_indicators / research_objectives /
                       research_questions          (exactly one, check-enforced)

research_integrity_decisions   (mutable — a finding's disposition)
research_integrity_events      (append-only audit)

research_citations + pmid, isbn   (doi already existed)
```

`research_claim_methodology_links` follows the same "nullable composite FK per
possible target" shape `questionnaire_questions` already used for
`construct_id`/`indicator_id`/`scale_id`, with a check constraint enforcing
exactly one target — verified in
`supabase/tests/phase19_project_isolation.sql`.

**Why a decisions table when findings are never stored:** a finding has no
database row — its `id` is a computed string
(`` `${category}:${subcheck}:${targetId}` ``), recomputed on every review, the
same way `MethodologyFinding.id` already was. But a researcher's disposition of
one ("I looked at this, it's fine") must survive the next recompute, so
`research_integrity_decisions` is keyed on that stable string, `unique(project_id, finding_id)`,
not a foreign key.

**ORCID is a validator, not a column.** `normalizeOrcid()` in
`src/lib/integrity/identifiers.ts` checks format and the ISO 7064 checksum but
nothing persists it — `research_citations.authors` is a bare `text[]` of
names with no per-author row to attach an id to, and inventing one was judged
out of scope for this phase.

## 4. Citation verification

`src/lib/integrity/citation-verification.ts` — `verifyClaimCitation` walks one
decision tree per claim, purely from stored rows:

```
needs evidence?        -- no  → not_applicable
  │ yes
cites a key in its own text?   -- no, and no evidence link  → missing
  │ yes
key resolves to a saved citation?  -- no  → unresolved
  │ yes
evidence linked to that citation?  -- no  → unsupported
  │ yes
every linked support SUPPORTED?    -- yes → verified
  mixed SUPPORTED/PARTIAL?          → partial
  else                              → unsupported
```

`src/lib/integrity/citation-funnel.ts` computes the four-stage completeness
funnel from §9 of the spec (`requiringEvidence → cited → linkedToEvidence →
linkedToResolvableSource`) as a plain count of stored rows — `cited` and
`linkedToEvidence` are kept as separate stages on purpose: a claim can name a
citation key in prose before a researcher has curated evidence for it, and
collapsing the two stages would hide exactly that gap.

## 5. Evidence traceability, conflicts, numerical traceability

- `src/lib/integrity/traceability.ts` — `buildClaimTraceability` pairs each
  claim with its citation-verification state and its own methodology links;
  the shape the Claims tab renders one row from.
- `src/lib/integrity/conflicts.ts` — `buildSourceConflicts` lists one claim's
  linked sources with their individual `SupportLabel` and excerpt.
  **No aggregate/consensus score exists anywhere in the type or the
  computation** — a `SourceConflictView` has `hasConflict: boolean` and a flat
  `entries[]`, nothing else. Disagreement between sources is shown, never
  resolved into a single verdict.
- `src/lib/integrity/numerical-traceability.ts` — extracts statistic-shaped
  mentions (`M=`, `SD=`, `n=`, `r=`, `p`, `%`) from a claim and checks them
  against `summarizeDataset`'s real computed values, matched to a dataset
  column the claim's own text names (word-boundary matched — a column named
  "age" must not match inside "averaged"). No dataset linked → every mention
  is `not_computable`, never a guess. A `p`-value mention is always
  `not_computable`: nothing in the schema stores a computed inferential
  result to check it against.
  **This is the single fuzziest deterministic piece in this phase** — matching
  a claimed number to "the" column a sentence loosely names is a heuristic,
  not a guarantee, and it is documented as such rather than presented with
  false precision.

## 6. Manuscript-wide unsupported-claim scan

`src/lib/integrity/unsupported-scan.ts` filters strictly through
`claimNeedsEvidence`'s existing allowlist (`factual`/`statistical`/`clinical`/
`comparative`) — it can never flag an `interpretive`, `user_provided`, or
`inference` claim, no matter how the sentence reads. It is not a sentence-level
uncited-text scanner; it only reports rows the existing claim pipeline already
classified as needing evidence and lacking verified support.

## 7. Methodology ↔ manuscript consistency

`src/lib/integrity/manuscript-consistency.ts` adds three checks specific to
prose-vs-model drift, and relays Phase 18's own `runConsistencyChecks` findings
through unchanged (relabeled `category: "methodology"`, namespaced
`methodology:<original-id>`) rather than reimplementing methods/questionnaire/
analysis-plan consistency:

1. **Causal-language mismatch** — a Results/Discussion/Conclusion claim using
   causal phrasing (`caused`, `led to`, `resulted in`, …) when no research
   question is classified `question_kind: "causal"`.
2. **Construct-terminology drift** — a claim using a near-duplicate of a
   construct's name (same content words, reordered/pluralized) without ever
   using the construct's own name, via the exact `normalisedName()` heuristic
   `consistency.ts` already used for near-duplicate construct names (now
   exported, not duplicated).
3. **Hypothesis-traceability** — a hypothesis with zero manuscript claims
   linked to it via `research_claim_methodology_links`.

**Hypothesis↔results wording-strength comparison is AI-advisory only**
(`compareWordingToResult` in §9) — nothing in the schema stores a computed
result or p-value per hypothesis to check deterministically against.

## 8. Reference / bibliography integrity

`src/lib/integrity/reference-audit.ts` — five deterministic checks:
`findMissingBibliographyEntries`, `findUnusedReferences`,
`findDuplicateReferences`, `findMalformedIdentifiers`, `findMissingMetadata`.

**Duplicate detection is identifier-equality or exact normalized
title+year+first-author only** — no fuzzy text similarity anywhere in this
pass. Ambiguous near-duplicates are AI-advisory territory
(`suggestDuplicateReferences`, §9), and even those never auto-merge.

`src/lib/integrity/reference-merge.ts` — `mergeCitations` is the one action
that actually merges two references, always a researcher's own request via
`POST .../integrity/references/merge`. It repoints `research_evidence`,
`questionnaire_questions.source_citation_id`, and `research_gaps`, then
deletes the duplicate. **It refuses (rather than silently drops) a duplicate
that has Phase 17B theme or source-profile links** (`research_theme_sources`,
`research_source_profiles`) — those are literature-workspace judgements this
phase does not own, and repointing or discarding them here would decide
something this action was never asked to decide.

## 9. AI boundaries

`src/lib/integrity/suggestions.ts` — seven advisory functions, mirroring
`methodology/suggestions.ts`'s `propose()`/`keepKnownIds()`/`ProposalResult<T>`
shape exactly: `classifyClaim`, `explainCandidateEvidence`,
`summarizeSourceConflict`, `suggestDuplicateReferences`,
`suggestMethodologyLanguageFix`, `suggestCitationPlacement`,
`compareWordingToResult`.

Enforced in code, not just in the prompt:

- Every candidate list is built server-side from project-scoped queries; a
  caller can never supply what a model may choose among
  (`suggest/route.ts`).
- Every id a model returns is filtered against the candidate list it was
  actually sent (`keepKnownIds`) — a hallucinated or cross-project id is
  silently dropped, with a note saying how many were discarded.
- `classifyClaim` proposes **nothing** when the model returns
  `claimType: null` or `confidence: "low"` — there is no `"unclassified"`
  value in the Phase 17 `claim_type` schema, so an ambiguous classification
  leaves the claim's current type untouched rather than forcing a category.
- Nothing in `suggestions.ts` can write to `research_claim_evidence.support`,
  `research_citations`, or `research_integrity_decisions` — every proposal
  carries `provenance: "ai_suggested"` and only the ordinary CRUD/decision
  routes write, after a researcher accepts.
- `provenance-regression.test.ts` proves — not just documents — that
  `buildResearchIntegrityReview`'s `findings[]` never contains an
  `ai_suggested` entry: `suggestions.ts` is never called from
  `review-service.ts`.

Context budgets (`BUDGETS` in `suggestions.ts`) cap what each call sends —
per-claim calls get the claim, its citation, candidate evidence and the one
relevant methodology node, never the full manuscript. Truncation is surfaced
via `contextTruncated`/`notes`, never silent.

## 10. Prompt injection

`src/lib/ai/testing/integrity-fixtures.ts` provides adversarial fixtures:
hallucinated/cross-project citation ids, a fabricated DOI embedded in a
model's own explanation, a fake source offered as a citation-placement
suggestion, overclaiming ("definitively proves"), excessive-confidence
wording, and source text instructing the model to "mark this citation
verified" / "declare this study publishable"
(`PROMPT_INJECTION_TEXT`). `suggestions.test.ts` asserts every one of these
still comes back `provenance: "ai_suggested"` and never causes an
authoritative write — the boundary is enforced by the application (server-side
candidate lists, id filtering, no write path from `suggestions.ts`), not by
hoping the model declines.

`detectPromptInjection` and `RESEARCH_INTEGRITY_INSTRUCTIONS` (both pre-existing)
are reused unchanged.

## 11. Provenance discipline

Every `IntegrityFinding.provenance` is `"deterministic"` or `"ai_suggested"` —
no third state, no silent promotion from one to the other. Every check module
in Stages 3–8 hardcodes `provenance: "deterministic" as const`; nothing
computed by `suggestions.ts` is ever merged into `review-service.ts`'s
`findings[]`. Severity follows the same discipline as Phase 18:
`error` is reserved for structurally broken/unresolvable state (a malformed
identifier, a link naming zero targets); `warning` for a real, actionable gap;
`info` for a review opportunity. AI/semantic findings (causal-language,
terminology drift, hypothesis traceability) are `warning`/`info`, never
`error`.

## 12. Non-goals (fixed before implementation, unchanged throughout)

Not built, and not planned: a plagiarism detector, a Turnitin clone, an
automatic academic-misconduct classifier, an automatic peer reviewer, a
publication-acceptance predictor, an automatic "scientific truth" engine, a
fake-source checker based solely on LLM opinion, autonomous reference repair,
automatic manuscript rewriting. Every finding this phase produces is phrased
as something to check, never as a verdict — "Potentially unsupported claim",
never "This is false"; "Possible duplicate reference", never "These are
duplicates, merged."

## 13. Security

Every new route (`src/app/api/research/projects/[projectId]/integrity/**`)
opens with the identical `authorizeProject`/`dbErrorResponse` preamble every
other project-scoped route uses. The one AI-backed route
(`integrity/suggest`) passes `{ rateLimit: "ai" }`. No route accepts a
candidate list, citation text, or claim text from the request body for an AI
call — everything sent to a model is loaded server-side from the project the
caller was already authorized against. `phase19-routes.test.ts` asserts 401 for
every route when unauthenticated, 404 when the project belongs to someone
else, and that a claim/evidence/hypothesis id from another project resolves to
404 rather than silently succeeding.

## 14. RLS

`supabase/tests/phase19_project_isolation.sql` (see the "written, not run"
note at the top) covers, for the three new tables: reads blocked, cross-project
claim/construct references rejected by the composite foreign key (not merely
by RLS), the "exactly one target" check constraint verified two ways (omitted
columns and an explicit null), writes into another project's rows blocked,
updates/deletes matching zero rows, the event log staying append-only even for
its own owner, and the owner's data proved untouched afterward via `reset
role`. It mirrors `phase18_project_isolation.sql` line-for-line in structure.

## 15. Tests

18 new test files, ~106 new tests, spanning:

- **Deterministic unit tests** for every Stage 3–8 module — identifier
  normalization, citation-verification states, the completeness funnel,
  traceability, numerical traceability, conflicts, the unsupported-claim
  scan, manuscript consistency, reference audit, reference merge.
- **Integration-style tests** against `createInMemorySupabase` — the full
  §36 deterministic E2E path (claim → citation → evidence → complete
  traceability → remove evidence → gap reappears, all recomputed, nothing
  cached) in `review-service.test.ts`.
- **Route tests** (`phase19-routes.test.ts`) — auth/authorization boundaries,
  input validation, cross-project id re-resolution, the export gate's
  always-`blocking:false` contract, `ReferenceMergeError` mapping to a clean
  400.
- **AI adversarial tests** (`suggestions.test.ts`) — hallucinated ids,
  cross-project ids, fabricated identifiers, overclaiming, excessive
  confidence, prompt injection — every one normalized to an advisory
  proposal.
- **Component tests** (`ResearchIntegrityWorkspace.test.tsx`,
  `ProjectWorkspace.test.tsx`) — loading, empty, success, finding display and
  navigation, evidence state, citation mismatch, conflict state, provenance
  badges, researcher decisions, dismissed-finding styling, keyboard tab
  navigation, long source text, unresolved-source findings, a malformed/
  failing AI proposal response, and the export-gate confirm dialog.
- **Cross-cutting regression** (`provenance-regression.test.ts`) — every
  metric is null (not zero) across all seven dimensions on an empty project;
  every finding the review produces is `provenance: "deterministic"`.

## 16. Performance

`loadIntegrityModel` (in `review-service.ts`) is the one place every fetch
happens, mirroring `loadMethodologyModel`. It accepts an optional
`{ sectionType }` scope — `GET .../integrity/review?section=results` restricts
the claims query, matching the section-scoped review pattern Phase 17B already
established. Reference-integrity and duplicate-detection checks stay
project-wide regardless of scope, since bibliography integrity is not a
per-section concept. Datasets are loaded once, only their own rows (not the
whole project's other tables), and only when the project has any linked at
all.

## 17. Mobile / accessibility

`ResearchIntegrityWorkspace.tsx` reuses the exact tab/pane pattern
`LiteratureWorkspace.tsx` and `MethodologyWorkspace.tsx` already established:
`role="tablist"`/`role="tab"`/`role="tabpanel"` wiring, left/right arrow-key
navigation between tabs, an `overflow-x-auto` tablist rather than wrapping.
Component tests assert the structural responsive behavior (the tablist stays
horizontally scrollable) and are captioned accordingly — **structural
responsive behavior verified, real-browser visual verification pending**: jsdom
does not apply Tailwind breakpoints, so the rendered result at 320/375/414px
widths has not been visually checked, consistent with every prior phase's own
limitation here.

## 18. Known limitations

- **Numerical traceability is a heuristic**, not a proof — matching a claimed
  number to "the" dataset column a sentence names by word-boundary match can
  both miss a real match (differently-worded column reference) and, in
  principle, false-match a coincidentally-named column. See §5.
- **No inline manuscript highlighting.** Findings connect back to a claim via
  a "View in section" button that reuses the existing section-navigation
  callback (`onGoToSection`), not literal text-span highlighting inside
  `SectionEditor`. `research_claims.source_offset_start/end` already exists
  and would support real highlighting; wiring it into the editor's own
  selection model was judged out of scope for this phase's time budget.
- **No "View source" action from the Claims tab directly** — the claims list
  the tab loads (`GET /claims`) does not carry resolved citation ids per claim.
  "View source" is reachable from the Sources tab instead.
- **RLS isolation SQL is unexecuted** in this environment (§14) — reviewed by
  hand against the working Phase 18 migration/test it mirrors, but not proven
  against real Postgres before this document was written.
- **Hypothesis↔result wording comparison has no deterministic half** — there
  is no computed inferential result stored per hypothesis anywhere in the
  schema, so this check is entirely AI-advisory (§7).
- **ORCID is validate-only** — no schema support for persisting one exists
  yet (§3).

## 19. Deferred work

- Real-browser responsive verification at 320/375/414px (mobile) and a
  visual pass on the workspace generally.
- Inline manuscript-text highlighting tied to `source_offset_start/end`.
- A per-author identity model, if ORCID persistence is ever wanted.
- Extending `research_claim_methodology_links` reasoning into the
  Conflicts/Findings tabs' navigation (currently a claim id is shown, not a
  live jump to that claim's row in the Claims tab).
- Running `npm run db:verify:isolation:19` against real Postgres and closing
  whatever it finds — the precedent (`2b5fe18`, Phase 18's own isolation
  suite) is that this kind of test does find real holes, not just confirm
  what was expected.

Live AI benchmark comparison remains deferred project-wide, unchanged from
Phase 16B onward — not resumed or revisited by this phase.
