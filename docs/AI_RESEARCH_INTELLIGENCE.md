# Research Intelligence Layer (Phase 5)

## What this phase adds

```
Alignment Engine        src/lib/ai/alignment-engine.ts    checkAlignment()
Quality Checker         src/lib/ai/quality-check.ts        runQualityCheck()
Integrity Guard (code)  src/lib/ai/integrity-guard.ts       requiresDataset() / verifyCitationKeys()
Structured output       src/lib/ai/schemas.ts + json-schema.ts
```

Plus one new route (`POST /api/research/projects/[id]/quality-check`) and a
`QualityCheckPanel` in the workspace.

## Structured output, not prose-parsing

Sections 20/32/33 need the model to return a specific shape (severity/
category/section/message/recommendation; a 7-field score breakdown) —
exactly the case Section 36 means by "use structured schemas... never
parse critical AI output with fragile regex." `ProviderGenerateRequest`
gained a `responseSchema` field that both providers now honor natively:

- Gemini: `config.responseMimeType = "application/json"` +
  `config.responseSchema`.
- OpenAI: `text.format = { type: "json_schema", strict: true, schema }`.

The two providers use different schema dialects — Gemini's is an
OpenAPI-derived format with uppercase `Type` enum values (`"OBJECT"`,
`"STRING"`), OpenAI's `json_schema` mode expects standard (lowercase)
JSON Schema. Rather than hand-maintain two dialects,
`src/lib/ai/schemas.ts` defines each schema once in the OpenAI/standard
dialect, and `json-schema.ts`'s `toGeminiSchema()` recursively uppercases
`type` for the Gemini call. `AIRequest.responseSchema` flows through
`AIOrchestrator.generate()` (both the primary and fallback provider
calls) exactly like any other field — callers don't need to know which
provider ends up handling the request.

The response is still `AIResponse.content` (a string) — callers
`JSON.parse()` it and validate with the matching Zod schema
(`alignmentResponseSchema`, `qualityCheckResponseSchema`). A schema
guarantees syntactic shape; it doesn't guarantee the *judgment* inside is
good, and a malformed response is still handled (see "Failure handling"
below) rather than assumed to never happen.

## Alignment Engine (`checkAlignment`)

Walks every `research_sections` row with content and asks the model
whether later sections actually follow from earlier ones — "does the
methodology/instrument actually measure what the objectives claim to
measure," not just "is every field non-empty." This is necessarily a
semantic judgment call, so it goes through the model (routed to the
`quality_check` task type → advanced tier); a purely structural check
can't tell you whether an instrument matches an objective.

Reuses the existing `prompts/quality-check.ts` system instruction from
Phase 1 (it already asked for this exact issue shape in prose) rather
than adding a parallel prompt file — the schema now enforces the shape;
the prompt still carries the semantic instructions.

## Quality Checker (`runQualityCheck`)

The dashboard-level check (spec §32/§33): one combined AI call (scores +
issues together, not two separate calls for overlapping analysis — §11
token-saving) plus two checks that need no model at all:

- **Structural**: are sections started? (a plain `research_sections`
  status scan, no semantic judgment needed)
- **Citation existence**: every `[citation_key]`-form reference across
  all section content, checked against `research_citations` for the
  project — see "Citation verification" below.

Scores are always paired with `disclaimer: "AI Quality Estimate — a
starting point for your own review, not an official grade."` (spec §33's
explicit requirement — never present this as an official grade).

## Integrity Guard, now partly enforced by code

`AI_RESEARCH_INTEGRITY.md` (Phase 1) said the guard was "prompt only, not
yet by code" — a model could still ignore a prompt instruction. Two
pieces of that are now real code, not just prompt text:

### The dataset guard (Section 19, "This rule is mandatory")

`requiresDataset(taskType)` is checked at the top of both
`AIOrchestrator.generate()` and `.stream()`, **and** independently in
both `/api/ai/*` routes before context assembly — a `results_generation`
or `data_analysis` request with no `dataSetId` never reaches a model at
all. There's nothing for it to hallucinate around, and no embedding/API
cost is spent building context for a response that's about to be
discarded. Verified for real against the local Supabase instance (no AI
provider keys needed for this path, since it short-circuits before any
provider call) — see the Verification section below.

**Still prompt-only**: this only catches the two task types that are
*definitionally* about reporting on real data. It does not — cannot,
without a much larger claim-extraction system — catch a model that
fabricates a specific statistic inside a `discussion` or `chat` response
where results are being referenced rather than generated. The prompt-
level integrity guard (`research-integrity-guard.ts`) is still the only
defense there.

### Citation verification (Section 15/18)

`extractCitationKeys()` scans text for the `[citation_key]` bracket
convention (the same one `context-manager.ts` uses when formatting
sources into a prompt) and `verifyCitationKeys()` checks each one against
`research_citations` for the project. A key that doesn't resolve to a
real row is flagged as a `high`-severity issue, not silently trusted.

**Limits, stated plainly**: this only catches citations in bracket form.
A citation mentioned as plain prose ("according to a 2024 WHO study...")
without a `[key]` is not caught — that would need real claim extraction
from unstructured text, which is a different, much larger project than a
bounded text scan. This is a real, working check for the intended/common
case (the app's own prompts ask for bracket-form citations), not a
complete solution to "never let a fabricated citation through."

## What's still prompt-only, not code (honest gaps)

- Fabricated statistics/percentages/participant counts inside ordinary
  prose responses (`chat`, `discussion`, etc.) — no structured claim
  extraction exists to check these against anything.
- The `EvidenceStatus` labels (`VERIFIED`/`SOURCE_REQUIRED`/...) the
  integrity-guard prompt asks the model to attach to claims — the model
  self-reports these; nothing verifies a `VERIFIED` label is actually
  backed by a real source.
- Ethics-approval / validated-instrument claims (spec §18, §26) — no
  code-level check exists for either.

## Verification

Unit tests (17 new) mock the orchestrator/db entirely — they verify this
codebase's own parsing/dispatch/guard logic, not that a real model
produces good alignment judgments or accurate scores. Two things *were*
verified for real against the local Supabase instance (Docker), because
the dataset guard's short-circuit needs no AI provider credentials:

- `POST /api/ai/generate` with `taskType: "data_analysis"`, no
  `dataSetId`, as a real authenticated user against a real project →
  `200`, the exact "Missing: Dataset" response, no provider ever called.
- `POST /api/ai/chat` with `taskType: "results_generation"` → same
  guard fires through the streaming path, and both the user's message
  and the guard's response were confirmed persisted to `ai_messages` via
  direct SQL.
- Confirmed the fix mattered: before it, both routes 500'd on this same
  request — not because the guard was wrong, but because
  `resolveRequestContext()` ran *before* the guard check and tried to
  embed the query for retrieval (real, billable work) regardless of task
  type, which fails without a real Gemini key. Moved the check earlier in
  both routes so a blocked request never reaches context assembly.

**Not verified**: alignment/quality-check output quality against a real
model (no AI provider keys available in this environment — the actual
`generate()` call inside `checkAlignment()`/`runQualityCheck()` was only
exercised through mocks). If real Gemini/OpenAI keys become available,
run the quality check against a real project with real section content
and read the output critically — a schema-valid response is not the same
as a *good* one.
