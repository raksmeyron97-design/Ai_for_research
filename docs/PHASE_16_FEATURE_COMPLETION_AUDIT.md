# Phase 16 — Feature Completion Audit

**Method.** Read from code, not from prior documentation. Date: 2026-09-01,
base commit `5d48aa4`.

**Scope rule applied.** §6 of the phase brief suggests generator filenames
(`introduction.ts`, `literature-review.ts`, `sampling.ts`, `instrument.ts`,
`ethical-considerations.ts`, `timeline.ts`) that do **not** exist in this
repository's section taxonomy. §3 says the repository taxonomy is
authoritative and forbids inventing a second one. The repository taxonomy
wins; the mapping is recorded below so the divergence is deliberate and
visible rather than silent.

---

## 1. The authoritative 18-section chain

`src/lib/db/types.ts:SECTION_CHAIN` — also enforced by a CHECK constraint on
`research_sections.section_type`, so it is the same list in the database:

`title` · `research_problem` · `rationale` · `research_gap` · `objectives` ·
`research_questions` · `variables` · `conceptual_framework` · `methodology` ·
`questionnaire` · `data_collection` · `data_analysis` · `results` ·
`discussion` · `conclusion` · `recommendations` · `references` · `appendices`

### Mapping from §6's suggested names

| §6 name | This repository |
| --- | --- |
| `introduction` | `research_problem` (+ `rationale`) — there is no "introduction" section |
| `literature-review` | `research_gap` — literature work is a *task* (`literature_review`), not a section |
| `sampling` | part of `methodology` — `sampling` is a TaskType, not a section |
| `instrument` | `questionnaire` |
| `ethical-considerations` | part of `methodology` — no dedicated section |
| `timeline` | **no equivalent**; not added (§3 forbids inventing sections) |

---

## 2. What already exists

### Dedicated generators (business logic, DB-aware)

| Module | Covers | Guard it enforces in code |
| --- | --- | --- |
| `results-generator.ts` | `results` | Dataset required; **the model never emits the numbers** — `summarizeDataset()` computes them and the model only writes prose about them |
| `discussion-generator.ts` | `discussion` | Results must have real content; citations verified after generation |
| `conclusion-generator.ts` | `conclusion`, `recommendations` | Objectives + (results or discussion) required; `detectUnsourcedNumbers()` flags new figures |
| `questionnaire-generator.ts` | `questionnaire` | Schema-validated; **nothing persists** unless the whole response validates |
| `quality-check.ts` | cross-section | Structural + citation checks in code, scores from the model |
| `alignment-engine.ts` | cross-section | Schema-validated issue list |

### Dedicated prompts

`prompts/` has 7 builders registered for 11 of 30 task types
(`prompts/index.ts`). Everything else falls through to
`buildDefaultSystemInstruction`.

| Prompt file | Task types served |
| --- | --- |
| `objectives.ts` | `objective_generation`, `research_question` |
| `methodology.ts` | `methodology`, `sampling`, `sample_size`, `methodology_audit` |
| `literature.ts` | `literature_review`, `source_search` |
| `quality-check.ts` | `quality_check` |
| `discussion.ts` | `discussion` |
| `conclusion.ts` | `conclusion` |
| `default.ts` | the other 19 task types |

---

## 3. Section coverage: what is missing

| Section | Prompt | Generator | Structured output | Verdict |
| --- | --- | --- | --- | --- |
| `title` | default | — | — | **missing** |
| `research_problem` | default | — | — | **missing** |
| `rationale` | default | — | — | **missing** |
| `research_gap` | literature | — | — | prompt only |
| `objectives` | objectives | — | — | prompt only, **no measurability/alignment check** |
| `research_questions` | objectives (shared) | — | — | prompt only, **no objective mapping** |
| `variables` | default | — | — | **missing**, and no confirmed/suggested distinction |
| `conceptual_framework` | default | — | — | **missing** |
| `methodology` | methodology | — | — | prompt only, **no structured review** |
| `questionnaire` | default¹ | ✅ | ✅ | complete |
| `data_collection` | default | — | — | **missing** |
| `data_analysis` | default | ✅ (analysis) | — | partial |
| `results` | default¹ | ✅ | — | complete |
| `discussion` | discussion | ✅ | — | complete |
| `conclusion` | conclusion | ✅ | — | complete |
| `recommendations` | conclusion (shared) | ✅ (shared) | — | complete |
| `references` | — | — | — | **missing** |
| `appendices` | — | — | — | out of scope (no AI action needed) |

¹ The questionnaire and results generators do excellent work but route
through `TaskType`s with no registered prompt, so they get the generic system
instruction. Their guarantees come from code and schemas, not the prompt.

**Score: 5 of 18 sections complete; 5 prompt-only; 8 with nothing
section-specific.**

---

## 4. Technical debt found

**D1 — Context is not section-aware (§5, §20).**
`context-manager.ts:buildContext` builds the same five layers for every
request: project profile, current section, vector-retrieved chunks, requested
citations, recent conversation. A `title` request and a `discussion` request
receive structurally identical context. Retrieval runs whenever a `query` is
present regardless of whether the section can use it. This is both a quality
problem (irrelevant context) and the token problem §20 names.

**D2 — There is no section action system (§4).**
`AICopilot` sends `taskType: "chat"` for everything. The 30 TaskTypes exist
and the classifier routes them, but no UI can reach them. Every action a
researcher takes is the same generic chat request.

**D3 — No versioning (§18).**
No version table, no history. `SectionEditor` sets
`metadata.aiAssisted = true` and `lastAiInsertAt` — deliberately coarse
session-level provenance, documented as such — but previous content is not
retained anywhere.

**D4 — Insert is append-only and unconditional (§17).**
`SectionEditor`'s insert effect appends to existing content. There is no
replace, no diff, no cancel. The requirement that AI must never silently
overwrite is currently satisfied only because overwriting is impossible.

**D5 — No mock provider for feature tests (§21).**
A deterministic stub exists, but only inside the benchmark harness
(`tests/ai-benchmark/runners/stub-provider.ts`). Application tests mock
`AIOrchestrator` per test file, so each one re-invents its own fake.

**D6 — No structured schemas for section output (§7).**
`schemas.ts` covers alignment, quality check and questionnaire only. Every
other generator returns free text.

**D7 — Shared prompt for objectives and research questions.**
`research_question` reuses `buildObjectivesSystemInstruction`, so questions
are generated by a prompt that asks for objectives.

---

## 5. Recommended implementation order

Dependency-first — each step unlocks the next:

1. **Section context policy** (D1) — required/optional/excluded per section.
   Everything else consumes it, and it is the §20 token requirement.
2. **Mock provider** (D5) — needed to test steps 3-8 without credits.
3. **Section registry**: prompt + actions + context policy + schema per
   section (D2, D6, D7).
4. **Generators for the 8 missing sections**, reusing the 5 that exist rather
   than duplicating them (§32).
5. **Objectives / research questions / variables** semantics: measurability,
   objective↔question mapping, confirmed-vs-suggested.
6. **Versioning** (D3) — table + record on accepted insertion.
7. **AI change control UI** (D4) — insert / replace / append / copy / cancel
   with a diff on replace.
8. **Offline end-to-end test** exercising the real wiring with mock AI.

## 6. Roadmap status

**Live AI Benchmark: DEFERRED.** Reason: feature-completion priority and
credit conservation. The harness is ready (`npm run ai:benchmark:smoke`), the
production path it measures is hardened (Phase 16A), and the only blocker is
provider billing credit. See `PHASE_16B_*` planning in
`PHASE_16_REAL_AI_VALIDATION_REPORT.md`.

## 7. Explicitly not doing

Per §32: no new database redesign, no replacement of the RAG pipeline, the
orchestrator, the questionnaire generator or the data-analysis logic. The
existing results/discussion/conclusion/questionnaire generators are wrapped
and reused, never reimplemented.
