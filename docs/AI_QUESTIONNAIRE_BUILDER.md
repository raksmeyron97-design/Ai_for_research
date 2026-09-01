# Questionnaire Builder (Phase 6)

## What this phase adds

```
Schema        supabase/migrations/*_phase6_questionnaire*.sql
              research_instruments, questionnaire_questions
Generator     src/lib/ai/questionnaire-generator.ts   generateQuestionnaire()
Data access   src/lib/db/instruments.ts, src/lib/db/questions.ts
Routes        POST/GET /api/research/projects/[id]/instruments
              GET/DELETE .../instruments/[instrumentId]
UI            QuestionnaireBuilder.tsx — replaces the plain textarea
              editor specifically for the "questionnaire" section
```

## Scoping decision: objectives/variables stay free text

Spec §25 describes questions mapping to an `objectiveId`/`variableId` — a
foreign key relationship implying `research_objectives`/
`research_variables` tables. Those don't exist: Phase 2 deliberately kept
objectives and variables as free text inside `research_sections`
(`section_type` `'objectives'`/`'variables'`), and this phase didn't
change that.

Each question instead maps to `objective_label`/`variable_label` as
**descriptive text**, not a foreign key — the AI reads the objectives/
variables section content as context and writes back which one a
question targets, in its own words. This is honest to what the app
actually has (prose, not structured rows) rather than adding foreign
keys pointing at entities that don't exist yet. If objectives/variables
are ever normalized into their own tables (the Phase 2 doc already
flagged this as the trigger for doing so), migrating these text labels
to real foreign keys is a follow-up, not a blocker to shipping this now.

## Generation (`generateQuestionnaire`)

Reuses the exact structured-output infrastructure from Phase 5
(`responseSchema` → both providers' native JSON modes, Zod validation on
the way back) — no new plumbing needed, just a new schema
(`QUESTIONNAIRE_RESPONSE_JSON_SCHEMA`/`questionnaireResponseSchema`).
Context is the project profile plus whatever content exists in the
`objectives`, `variables`, and `rationale` sections — sections with no
content yet are simply omitted, not padded with empty headers.

**Unlike the alignment engine/quality checker**, a malformed or
schema-invalid response is not degraded into a "check didn't run
cleanly" placeholder — `generateQuestionnaire` throws
`QuestionnaireGenerationError` and persists nothing. The difference:
alignment/quality checks are read-only analysis where returning a
placeholder "review manually" issue is a reasonable degradation, but
questionnaire generation *writes* a new instrument and its questions —
partially saving one that failed the validated-instrument-safety check
would be worse than a clean failure the researcher can retry. Verified
in the browser: a forced failure (no AI provider available) surfaced as
a plain error message with the existing instrument list untouched, and
confirmed via direct SQL that nothing partial was written.

## Validated Instrument Safety (spec §26), enforced twice

Never claim a tool is validated or adapted without naming what it's
based on. Enforced at two independent layers, not just a prompt
instruction:

1. **Zod, at parse time** (`schemas.ts`'s `instrumentSchema.refine()`):
   `validation_status !== "researcher_developed"` requires a non-empty
   `source_reference`. A response that violates this never reaches the
   database — `generateQuestionnaire` throws before calling
   `createInstrument`.
2. **A `CHECK` constraint, at the database** (
   `source_reference_required_unless_researcher_developed`): the same
   rule holds even for a row inserted by a path that skips the Zod
   schema — a future admin tool, a manual fix, a bug in the generator
   itself. Verified for real against the local Supabase instance:
   inserting `validation_status: 'validated'` with no `source_reference`
   via the raw REST API returns `23514` (constraint violation); the same
   insert with a real `source_reference` succeeds.

The generator's prompt also explicitly tells the model to default to
`researcher_developed` and only claim `validated`/`adapted` when it can
actually name the real instrument (EPDS, a WHO tool, etc.) — the prompt
instruction is the first line of defense, the two enforced layers above
are what happens if the model ignores it.

## The workspace UI

The "Questionnaire / Instrument" section in the navigator (an existing
`section_type` from Phase 2) now renders `QuestionnaireBuilder` instead
of the generic `SectionEditor` textarea — the one section-specific
editor in the app so far, everything else still uses free text. Shows a
list of generated instruments (validation badge, source), and per-
instrument the questions grouped by section label with their objective/
variable/construct mapping and response type.

## What's not built in Phase 6

- Editing individual questions in the UI (reorder, change response type,
  edit text) — the data-access layer (`updateQuestion`) supports it, no
  UI calls it yet. Only generate-and-view exists.
- Regenerating/adding to an existing instrument — each "Generate with
  AI" click creates a brand new instrument; there's no "add more
  questions to this one" flow.
- Exporting the questionnaire (PDF/DOCX) — that's Phase 9.
- Objectives/variables as structured, selectable entities (see the
  scoping decision above) — still free text.
- Question-level piloting/validation workflow (spec doesn't require this
  yet, but a real instrument-development process would).

## Verification

26 new unit tests (165 total): the validated-instrument-safety Zod
refinement (the most important logic here — tested thoroughly: accepts
`researcher_developed` with no source, rejects `validated`/`adapted`
with an empty or whitespace-only source, accepts them with a real one),
the generator's context assembly and all-or-nothing persistence
(mocked), and the new DB modules.

**Verified for real against the local Supabase instance** (Docker),
continuing the pattern from Phase 5: all 9 migrations (Phase 2 through
6) applied cleanly from a full reset; RLS confirmed on both new tables
via two real users (cross-user list/insert both correctly denied,
`403`/empty as expected); the `CHECK` constraint fired correctly through
the real REST API for both the failing and succeeding case; the full
UI → API → DB round trip was exercised in a real browser session (viewed
a real instrument's real questions, triggered a real generation attempt
that failed cleanly with no partial writes).

**Not verified**: actual questionnaire generation quality — no real
Gemini/OpenAI keys are available in this environment, so the generator's
`AIOrchestrator.generate()` call was only exercised through Phase 5's
existing mocked test infrastructure and one real (intentionally failing)
browser request. If real AI keys become available, generate a
questionnaire against a project with real objectives/variables content
and read it critically — schema validity is not the same as good
question design.
