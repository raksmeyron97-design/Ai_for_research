# Phase 17 — Evidence Workspace Audit

**Method.** Read from code. Date 2026-09-01, base commit `e11eec7`.

---

## 1. What exists and is reusable

| Capability | Where | Reuse verdict |
| --- | --- | --- |
| Vector retrieval | `db/chunks.ts:searchChunks` + `match_document_chunks` RPC, HNSW/cosine, RLS-invoker, returns `citation_key` per chunk since Phase 16 | **Reuse as-is.** §7 forbids a second embedding system, and there is no reason to want one. |
| Embeddings | `ai/embeddings.ts` (Gemini, 768-dim) | Reuse. |
| Sources | `research_citations` — key, title, authors, year, journal, doi, url, `source_type`, `tier` (1-4), `status` | Reuse. Already carries the quality metadata §9 asks for. |
| Source ↔ document link | `research_documents.citation_id` (Phase 16 F2) | Reuse — this is what makes an excerpt attributable. |
| Citation key extraction + verification | `ai/integrity-guard.ts`, two-stage grammar | Reuse for §15. |
| Section versions | `research_section_versions`, insert-only under RLS | Reuse for §21/§22. |
| Word diff | `lib/text/diff-words.ts`, LCS with a large-input fallback | Reuse for §23. |
| Section actions incl. `add_evidence` | `ai/sections/actions.ts` | Extend, do not replace. |
| Context policy | `ai/sections/context-policy.ts` | Reuse — it is already the §31 token answer. |
| Mock provider + in-memory Supabase | `ai/testing/` | Extend with the §27 fixtures. |
| Structural + citation checks | `ai/quality-check.ts:checkStructure`, `verifyCitationsInText` | Reuse as review inputs. |

## 2. What is missing

**M1 — Evidence has no representation at all.** The chain §3 requires is
Source → Evidence excerpt → Claim → Citation → Section. Today only *Source*
(`research_citations`) and *Section* exist. An excerpt lives transiently in a
prompt and is gone; a claim is never modelled; a citation is a bracket token
in free text. Three of the five links do not exist, so nothing can be queried,
verified later, or counted.

**M2 — `add_evidence` is a search, not a workflow.** The action routes to
`source_search` and returns prose. There is no claim extraction, no evidence
card, no selection step, no insertion, and no persisted relation.

**M3 — No deterministic coverage denominator.** §18 requires evidence coverage
computed from countable claims. With no claim table there is nothing to count,
so any percentage today would have to come from a model — exactly what §16
forbids.

**M4 — Quality scores are model-authored.** `quality-check.ts` asks the model
for all seven 0-100 scores. §16 requires explainable, derived scores. The
structural and citation checks that *are* deterministic already exist but are
returned as issues, never as scores.

**M5 — No framework persistence.** Phase 16 added the conceptual-framework
schema and generator; nothing stores the result, so there is nothing to edit.

**M6 — No version history UI, no restore.** Rows are written and readable
through the db layer only.

**M7 — Desktop-only layout.** `ProjectWorkspace` is a fixed
`grid-cols-[220px_1fr_360px]`; below ~900px the three panes are unusable.

**M8 — No DOM testing.** `vitest` runs in `environment: "node"` and no DOM
library is installed, so no component behaviour is covered.

## 3. Schema decision (§4)

The existing schema **cannot** represent evidence excerpts, claims, or the
claim↔evidence↔section relations — `research_citations` is a bibliography row,
not a claim or an excerpt, and `document_chunks` is a retrieval artefact with
no user-curated meaning. Three new tables are therefore justified rather than
avoidable:

- `research_claims` — a claim extracted from a section, with type and status.
- `research_evidence` — a curated excerpt from a source (optionally anchored
  to the chunk it came from), with page/section metadata.
- `research_claim_evidence` — the many-to-many link carrying the *support*
  judgement, which belongs on the relation and not on either side: the same
  excerpt can support one claim and fail to support another.

All three carry `project_id` and follow the existing RLS pattern
("reachable only through a project the caller owns"), giving §29 isolation by
the same rule every other table uses.

## 4. Recommended implementation order

1. Evidence data model + RLS + db layer (unblocks everything).
2. Deterministic logic: claim typing, evidence status, coverage, citation
   verification — the parts §15/§16/§18 require to be explainable.
3. Section review computation from those checks.
4. Claim extraction and evidence search through the existing RAG, mock-driven.
5. Framework persistence + structural validation.
6. Version restore (append-only) and history UI.
7. Responsive layout.
8. DOM testing library + component tests for the critical interactions.

## 5. Not doing

No second retrieval system (§7). No replacement of the orchestrator, RAG,
questionnaire or data-analysis logic. No live provider call anywhere in this
phase.
