# Phase 17B — Implementation Audit

Written before any Phase 17B code, against commit `2dd79d5` (770 tests / 73
files, lint + typecheck + build + offline dry benchmark passing).

The purpose is to establish what already exists so Phase 17B *mounts and
extends* rather than rebuilds. Phase 17 built most of the machinery and almost
none of the researcher-facing surface; the honest summary is that a researcher
using the app today cannot reach any of it.

---

## 1. Already complete and verified

| Area | Where | State |
| --- | --- | --- |
| Claim / evidence / relation schema | `supabase/migrations/…phase17_evidence_model.sql` | Complete, with composite same-project foreign keys |
| Append-only version history | `…phase16_section_versions.sql`, `…phase17_version_restore.sql` | Complete; no update/delete policy |
| Deterministic claim status + coverage | `src/lib/evidence/status.ts` | Complete, 100% model-free |
| Deterministic section health | `src/lib/evidence/section-review.ts` | Complete — computes 4 metrics + findings |
| Framework validation | `src/lib/evidence/framework-validation.ts` | Complete (editor not built — out of 17B scope) |
| Evidence data access | `src/lib/db/evidence.ts` | Claims, evidence, links, `refreshClaimStatus` |
| Version data access + restore | `src/lib/db/section-versions.ts` | `restoreSectionVersion` writes a NEW version |
| `SectionReviewPanel` component | `src/components/SectionReviewPanel.tsx` | Built + 12 DOM tests — **not mounted** |
| `VersionHistory` component | `src/components/VersionHistory.tsx` | Built + DOM tests — **not mounted** |
| Responsive pane shell | `src/components/WorkspacePanes.tsx` | 3 tabs below `lg`, panes stay mounted |
| RAG retrieval | `src/lib/db/chunks.ts` `searchChunks` + `match_document_chunks` RPC | Complete |
| Section context policy | `src/lib/ai/sections/context-policy.ts` | Per-section layer allowlist, gates embedding calls |
| Citation integrity | `src/lib/ai/integrity-guard.ts` | Key grammar + resolution against `research_citations` |
| Prompt-injection guard | `src/lib/ai/prompt-injection-guard.ts` | Heuristic warning; content treated as data |
| Deterministic mock provider | `src/lib/ai/testing/mock-provider.ts` | Scriptable; patches both real adapters |
| In-memory Supabase | `src/lib/ai/testing/in-memory-supabase.ts` | select/eq/in/order/limit/insert/upsert/update — **no `delete`, `rpc` throws** |
| Real-Postgres isolation checks | `supabase/tests/phase17_project_isolation.sql` | 8/8 pass |

## 2. Built but NOT mounted — Priority 1 and 2

`SectionReviewPanel` and `VersionHistory` both take fully-typed props and have
no data fetching. Nothing in `SectionEditor.tsx` or `ProjectWorkspace.tsx`
imports either one. There is also no API route that returns section health or
a version list, so mounting them requires the endpoints as well as the wiring.

Concretely missing for Priority 1/2:

- `GET  …/sections/[sectionType]/review` — no such route
- `GET  …/sections/[sectionType]/versions` — no such route
- `POST …/sections/[sectionType]/versions/restore` — no such route
- No normalized `SectionReview` response type; `reviewSection()` takes
  pre-assembled inputs (claims, present prior sections, resolved/unresolved
  citation keys) that nothing currently assembles.

## 3. Existing APIs that can be reused unchanged

- `PUT …/sections/[sectionType]` — saves content **and** records a version,
  taking a `change.action` discriminator. Phase 17B adds `evidence_insert` and
  `restore` to that vocabulary rather than inventing a second save path.
- `GET/POST …/citations` — the source library.
- `POST …/sections/[sectionType]/ai` — the section-action pipeline
  (`runSectionAction`), which already routes through the orchestrator, the
  context policy, the integrity guard and citation verification.
- `PATCH …/documents/[documentId]` — document ↔ source linking.

Every route uses the same authorize shape: `requireUserId()` → `getProject()`
→ 404 when the project is not the caller's. Phase 17B routes must copy it, and
must additionally verify that any claim/evidence/source id in the body belongs
to that project (§34) — passing an id alone must never be sufficient.

## 4. Database tables that already exist

`research_projects`, `research_sections`, `research_documents`,
`research_citations`, `document_chunks`, `research_claims`,
`research_evidence`, `research_claim_evidence`, `research_frameworks`,
`research_section_versions`, plus questionnaire/dataset/rate-limit tables.

**Not present, and required by Phase 17B:** literature themes, theme↔source
assignment, research-gap records, and the per-source comparison profile
(population / design / sample / variables / finding / limitations).

## 5. What must be added

1. **Migration** — `research_themes`, `research_theme_sources`,
   `research_source_profiles`, `research_gaps`; all project-scoped, all with
   the composite same-project foreign keys Phase 17 established, all RLS'd.
2. **`change.action` vocabulary** — `evidence_insert` and `restore` must be
   accepted by `upsertSectionSchema` and the DB check constraint, so an
   evidence insertion is not mislabelled as an AI rewrite (§29).
3. **One section-review service** returning the normalized `SectionReview`
   contract, fetching only that section's rows (§4, §5).
4. **Claim extraction** — schema, prompt, deterministic post-processing,
   mock fixture.
5. **Deterministic evidence ranking** — semantic + lexical + section context +
   source quality, with quality unable to rescue an irrelevant source (§14).
6. **Evidence insertion service** — persists evidence, the claim↔evidence
   relation with its support judgement, and the citation, in three modes
   (§17), then runs deterministic post-insert validation (§19).
7. **Literature surfaces** — evidence cards, comparison, themes, gap matrix,
   source detail, under one shared navigation (§25).
8. **Mobile** — Review and Evidence added to the pane tabs without duplicating
   business logic.

## 6. What can be reused rather than rebuilt

- `computeCoverage` / `deriveClaimStatus` — the coverage number after an
  insertion must come from these, never from a model (§28).
- `reviewSection` — the review service assembles inputs for it; the scoring
  logic is not touched.
- `searchChunks` + `match_document_chunks` — the one vector index (§13).
  Evidence search takes a *retrieval port* whose default is this, so offline
  tests can inject a deterministic retriever without a second index existing.
- `extractCitationKeys` / `verifyCitationKeys` — citation validity.
- `diffWords` — version comparison.
- `WorkspacePanes` — extended with tabs, not replaced.
- `createMockProvider` — extended with fixtures, not replaced.

## 7. Constraints discovered during the audit

- **`embedQuery` is a live Gemini call.** Any claim→evidence search that ran
  it in a test would spend credit. Evidence search therefore takes an
  injectable retriever; tests inject a deterministic one.
- **`createInMemorySupabase().rpc()` throws by design** and there is no
  `delete()`. Themes need delete; the e2e needs no rpc because retrieval is
  injected. `delete()` must be added to the fake.
- **The mock provider's `withMockProvider` patches the two real adapters**, so
  every offline test exercises the real orchestrator. Phase 17B keeps this.
- **`research_claims.section_type` is `text`, not FK'd to a section row.** A
  claim is located by (project, section type) plus best-effort character
  offsets; offsets do not survive an edit, and the UI must not pretend they do.
