# Phase 17 — Advanced Evidence & Literature Workspace

**Status: PARTIAL.** The evidence data model, the deterministic review logic
and three of the four Phase 16 UI gaps are complete and verified. The
researcher-facing *literature* surfaces — evidence cards, source comparison,
themes, the gap matrix — are not built. See §9.

**Live AI benchmark: DEFERRED.** No paid provider call was made. 770 tests
(was 739 at phase start), lint, typecheck, build and the offline dry benchmark
all pass with no provider contacted.

---

## 1. Evidence model

The chain §3 requires is Source → Evidence excerpt → Claim → Citation →
Section. Before this phase only *Source* (`research_citations`) and *Section*
existed: an excerpt lived inside a prompt and was gone afterwards, a claim was
never modelled, and a citation was a bracket token in free text. Three of the
five links did not exist, which is also why evidence coverage could not be
computed without asking a model to invent the denominator.

Three tables, because `research_citations` is a bibliography row and
`document_chunks` is a retrieval artefact — neither can carry a curated
excerpt or an assertion:

| Table | Holds |
| --- | --- |
| `research_claims` | An assertion in a section, with `claim_type`, `needs_evidence`, `evidence_status` |
| `research_evidence` | A curated excerpt from a source, with page/section and an optional link to the chunk it came from |
| `research_claim_evidence` | The link, carrying the **support judgement** |

Support lives on the *relation*, not on either side, because the same excerpt
can support one claim and fail to support another. That is precisely §15's
point: a citation existing in the database does not mean it supports the claim
it was attached to.

`research_frameworks` stores the conceptual framework as one JSONB document —
it is edited and saved whole by one researcher, is small, and has no
cross-framework queries, so node and edge tables would add joins and RLS
surface for no query anyone makes.

## 2. Project isolation — and a hole RLS did not close

RLS follows the existing pattern: reachable only through a project the caller
owns. **That is not sufficient on its own**, and the gap was found by testing
rather than assumed away.

The policies check the row's *own* `project_id`. So user B could write a
`research_claim_evidence` row labelled with B's project that pointed at user
A's claim and evidence — RLS passed, because the label was honest. Verified
against the live database: **the write succeeded.**

The fix is structural rather than another policy: composite foreign keys that
carry `project_id` into the reference, so a relation can only point at a
parent in the same project. `research_evidence → research_citations`,
`research_evidence → research_documents`, and both sides of
`research_claim_evidence` are now composite. The write now fails on the key,
regardless of what any present or future policy checks.

`supabase/tests/phase17_project_isolation.sql` (`npm run db:verify:isolation`)
re-runs all eight checks against real Postgres. Mocked DB tests cannot verify
this — RLS is a database feature and an in-memory fake returns whatever it is
asked for.

One trap worth recording: the first version of that script seeded the same
`(claim_id, evidence_id)` pair it later tried to insert, so the unique index
fired *before* the foreign key. It looked like a pass and proved nothing. The
script now uses a distinct row and treats a `unique_violation` as an explicit
test-unsoundness failure.

## 3. Deterministic evidence logic (§6, §18)

`src/lib/evidence/status.ts`. No model is consulted anywhere in it.

**Which claims need evidence.** `factual`, `statistical`, `clinical` and
`comparative` do. `interpretive`, `user_provided` and `inference` do not — §5
is explicit that not every sentence needs a citation, and counting a
researcher's own reading against coverage pushes them toward citing things
that do not need citing.

**The only path to SUPPORTED.** Status is derived purely from the support
judgements on linked evidence; there is no branch that upgrades a claim
because evidence merely *exists*. A `NEEDS_REVIEW` link leaves the claim
`NEEDS_VERIFICATION`, which is the case that matters: attaching a source is not
the same as checking it. An `inference` stays an inference no matter what is
cited.

**Coverage** is a count of rows. Partially supported claims count as half —
a convention, not a measurement, so `explanation` says so rather than letting
a reader assume precision that is not there. Coverage is `null`, not `0`, when
nothing requires evidence: "not applicable" and "zero" are different answers.

## 4. Section review panel (§16–§18) — Phase 16 gap #2 closed

`section-review.ts` computes completeness, evidence coverage, research
alignment and citation integrity from countable checks, and each score carries
the explanation shown beside it. Where a dimension is not computable it reports
`null` and the panel renders `n/a` — a researcher shown "70%" will reasonably
assume the 70 counts something, so it has to.

Findings carry severity, the claim, a reason, a recommendation and a
machine-readable `action`, so the UI offers a button rather than prose.

Two judgement calls in the wording: a clean result says *"the checks above
passed, not that the section is finished"*, and research alignment says it
measures *whether the chain exists*, not whether the content agrees — that is
what Check alignment does.

## 5. Version history and restore (§21–§23) — Phase 16 gap #5 closed

Restore writes a **new** version whose content came from the old one. The
obvious implementation — overwrite and delete everything after the restore
point — is exactly what §22 forbids: a researcher who restores an earlier
draft and changes their mind would have no way back. Intermediate versions
stay; `restored_from_version_id` records where the content came from.

The UI says "creates a new version from it. Nothing after it is deleted",
because wording it as a revert would make a researcher hesitate to use it.
Manual edits show no model rather than being attributed to one.

## 6. Responsive workspace (§24–§25) — Phase 16 gap #4 closed

Desktop keeps the three-pane grid unchanged. Below `lg` the same panes become
tabs.

**One DOM tree, not two.** Rendering a mobile layout beside a desktop layout
and hiding one with CSS duplicates every interactive control and every id
inside the panes — two editors, two AI panels — which assistive technology
reads twice and which breaks label association. The panes render once; only
visibility is responsive.

Panes stay **mounted** when a tab is inactive, so switching tabs never
discards editor text or an AI suggestion waiting for review. Arrow-key
navigation, roving tabindex, and a labelled tablist; all asserted in tests.

## 7. Component testing (§26) — Phase 16 gap #6 closed

`jsdom` + `@testing-library/react`, opt-in per file via
`// @vitest-environment jsdom` so the ~700 non-DOM tests keep running in Node.
Vitest 4 transforms with oxc rather than esbuild, so JSX is configured through
`oxc: { jsx: { runtime: "automatic" } }` — the `esbuild` option is silently
inert.

31 component tests cover researcher-visible behaviour, not markup: what a
score says, whether `n/a` appears instead of a fabricated number, whether a
finding is actionable, whether switching tabs loses work, whether restore
explains itself.

## 8. Framework validation (§20)

`framework-validation.ts` checks orphans, disconnected outcomes, duplicates,
self-loops, dangling edges, and whether declared variables and objectives are
represented. It returns a `checked` list alongside the issues so a clean result
is not mistaken for scientific endorsement — §20 is explicit that structural
validity is not correctness.

## 9. What was NOT built

Stated plainly rather than implied by omission. This is the larger half of the
phase brief by surface area:

1. **Evidence cards and the insertion flow (§8, §13).** The data model, the
   status logic and the relation table all exist, but there is no card UI, no
   claim-selection step and no citation preview. `add_evidence` still behaves
   as a source-grounded search.
2. **Claim extraction (§5).** No extraction pass, no schema, no mock fixture.
   Claims can only be created programmatically.
3. **Source comparison (§10)**, **literature themes (§11)** and the **research
   gap matrix (§12)** — none built. These are the "literature workspace" half
   of the phase name.
4. **Citation verification UI (§15).** The support labels exist on the
   relation; nothing surfaces or edits them.
5. **Conceptual framework editor (§19).** Validation and persistence exist;
   the visual editor does not. Phase 16 gap #3 remains open.
6. **Search/filter (§33)** over the source library.
7. The review panel and version history components are **built and tested but
   not yet mounted** in `SectionEditor` — they take props and have no data
   fetching wired.

## 10. Known limitations

- Evidence coverage counts a partially supported claim as half. Defensible,
  but arbitrary; the explanation string says so.
- Objective representation in a framework is a word-containment heuristic and
  will miss a paraphrase.
- Completeness uses a word count against a rough per-section target — a weak
  proxy, capped, and never the sole basis for a finding.
- `npm test` stays hermetic, so isolation is verified by a separate SQL script
  that needs the local stack running.
- No live provider call anywhere; nothing here is a claim about model output.
