# AI Thesis & Research Assistant — Architecture Audit

## 1. Starting state

This was a **greenfield build**: the working directory contained no code,
no `.git`, and no prior implementation. The master spec for this project
assumes an existing production codebase to audit; that assumption did not
hold here, so this document replaces "audit of existing system" with
"record of the greenfield decisions made and what exists now," and the
usual audit sections (existing AI capabilities, existing DB models, etc.)
are marked N/A where there was nothing to inspect.

Decisions confirmed with the user before implementation:
- **New project**, not an extension of something else.
- **Stack: Next.js (App Router, TypeScript) + Supabase** (auth, Postgres,
  storage) — chosen for fit with the doc-editor/RAG/streaming-chat
  workload the spec describes, and because Supabase gives auth + Postgres
  + row-level security + file storage in one system, reducing the number
  of moving parts for a solo/small-team build.
- **Delivered incrementally with checkpoints**, not in one shot: the full
  spec is 10 phases / 65 sections — realistically weeks of work. Phase 0
  + Phase 1 shipped and were reviewed first; this document was then
  updated in place for Phase 2 (§2b) rather than duplicated, so it stays
  the single source of truth for "what exists now."

## 2. What exists now (Phase 0 + Phase 1)

### Project scaffold
- Next.js 15 (App Router, `src/` layout, TypeScript strict mode, Tailwind,
  ESLint), hand-scaffolded rather than via `create-next-app` because the
  sandboxed shell's network access was too unreliable for the scaffolding
  CLI's interactive install step; the resulting file layout is standard
  Next.js and not different from what the CLI would have produced.
- `vitest` for unit tests.

### AI provider foundation (`src/lib/ai/`)
Implements the architecture from spec Section 5:

```
API route → AIOrchestrator → TaskClassifier → Router → Gemini | OpenAI
                                                  ↓
                                          PromptManager (+ integrity guard)
                                                  ↓
                                            TokenManager (usage logging)
```

| File | Responsibility |
|---|---|
| `types.ts` | `AIProvider` interface, `AIRequest`/`AIResponse` contracts (spec §45–46), `TaskType`, `TaskClassification` |
| `providers/gemini.ts` | `GeminiProvider` — wraps `@google/genai`'s `models.generateContent` / `generateContentStream` / `countTokens` |
| `providers/openai.ts` | `OpenAIProvider` — wraps the OpenAI Node SDK's Responses API (`responses.create`, including `stream: true`) |
| `task-classifier.ts` | Static, rule-based mapping of `TaskType` → model tier (`simple`/`standard`/`advanced`) + provider + `needsWeb`/`needsDocuments`/`needsData`/`needsCitations` flags. Never calls a model to classify — that would defeat the point of cheap routing (§9). |
| `router.ts` | `resolveProvider()` turns a classification into a concrete provider+model, honoring `AI_ENABLE_GEMINI`/`AI_ENABLE_OPENAI`; `resolveFallback()` is the runtime fallback path when a call fails (not just when a provider is disabled); `getReviewerProvider()` for dual-model verification |
| `model-config.ts` | Reads model IDs and feature flags from `process.env` once; no model ID is hard-coded elsewhere in the app (§7) |
| `prompt-manager.ts` + `prompts/*.ts` | Per-task-type system instructions (§22) — a handful are implemented (objectives, methodology, quality-check, literature) as the pattern; the rest of the 18 task types fall back to `prompts/default.ts` until their section generators are built in later phases |
| `research-integrity-guard.ts` | Fixed instruction block appended to **every** system instruction: never fabricate participants/results/statistics/citations, label claims with an evidence status, refuse to invent empirical results with no dataset present (§15, §18, §19, §59) |
| `token-manager.ts` | `estimateTokens` (character-based fallback), `calculateCost` (per-model USD/1M-token table, defaults for unknown models), `buildUsageRecord`/`recordUsage` (currently logs structured JSON; Phase 10 swaps the sink to a DB table without touching call sites) |
| `errors.ts` | `AIProviderError` (retryable flag), `AllProvidersFailedError`, `withRetry()` — timeout + exponential backoff, retries only when a failure is marked retryable |
| `orchestrator.ts` | `AIOrchestrator.generate()` / `.stream()` — the single entry point every API route calls. Classifies → routes → calls provider → on failure, falls back to the other provider once → records token usage on every outcome (success or failure) → optionally runs a second-model verification pass, but only for tasks in an explicit high-risk list or when `requireVerification` is set (§6: never dual-call by default) |
| `request-schema.ts` | Zod schema validating every inbound AI request at the API boundary |

### API routes
- `POST /api/ai/generate` — non-streaming, returns the full `AIResponse`.
- `POST /api/ai/chat` — streams plain-text deltas.
- Both require an authenticated Supabase session (401 otherwise). Neither
  yet checks *project-level* ownership, because there is no
  `ResearchProject` table yet — see Risks below.

### Supabase (`src/lib/supabase/`)
- `client.ts` — browser client (anon key only).
- `server.ts` — server/route-handler client (cookie-based session), plus
  `requireUserId()` used by both AI routes.
- No schema/migrations yet — Supabase project itself still needs to be
  provisioned by the user (URL + anon key + service role key go in
  `.env.local`, see `.env.example`).

### Tests
- `src/lib/ai/__tests__/task-classifier.test.ts` — tier/provider routing,
  feature-flag fallback, verification triggers.
- `.../router.test.ts` — provider resolution, disabled-provider fallback,
  `AIConfigError` when both providers are off.
- `.../token-manager.test.ts` — cost math, usage-record estimation vs.
  provider-reported usage.
- Integration/E2E/security tests from spec §53 are **not** implemented yet
  — they need real provider credentials and the project/document data
  model, both out of scope for this pass.

## 2b. What exists now (Phase 2)

Full detail lives in [`AI_DATABASE_SCHEMA.md`](./AI_DATABASE_SCHEMA.md)
(schema design decisions, RLS approach, migration instructions). Summary:

- **Schema**: `research_projects`, `research_sections` (the 18-section
  Title→Appendices chain), `research_documents` (+ a Storage bucket),
  `research_citations`, `ai_conversations`/`ai_messages`, `ai_usage` — in
  `supabase/migrations/*_phase2_*.sql`. Not applied to a live database in
  this build environment (no Postgres/Docker available here) — apply via
  the Supabase CLI or dashboard SQL Editor per the migration doc.
- **RLS**: every table isolated by `research_projects.user_id`, including
  the storage bucket (path-prefix check). This closes the "no
  project-level authorization" gap flagged in the Phase 1 risks below —
  see the updated risk entry.
- **Data access layer**: `src/lib/db/{types,errors,projects,documents}.ts`
  — CRUD for projects and documents, `getProjectProgress()` (computed,
  not stored), storage upload/delete with rollback on partial failure.
  19 new unit tests (41 total) mocking the Supabase query builder — these
  test this codebase's query logic, **not** that RLS itself holds; that
  needs an integration test against a real Postgres instance, which
  wasn't possible in this environment (see "What's not tested yet" in the
  schema doc).
- **Not built in Phase 2**: API routes for projects/documents (not asked
  for in this pass — the data-access layer is ready for them), the
  normalized objective/variable/hypothesis tables from the master spec's
  full entity list (deferred to when the questionnaire/alignment-engine
  phases need to query them as rows), and wiring `token-manager.ts`'s
  `recordUsage()` to actually insert into the new `ai_usage` table (it
  still only logs to stdout — the table exists, the write path doesn't
  yet, since `AIOrchestrator` doesn't hold a request-scoped DB client).

## 2c. What exists now (Phase 3)

Full detail lives in
[`AI_RAG_ARCHITECTURE.md`](./AI_RAG_ARCHITECTURE.md). Summary:

- **Upload → extraction → chunking → embedding → storage pipeline**:
  `POST /api/research/projects/[projectId]/documents` (multipart,
  25MB cap, explicit project-ownership check) →
  `src/lib/documents/process.ts` orchestrates
  `extract.ts` (PDF via `pdf-parse`, DOCX via `mammoth`, XLSX via
  `exceljs` — deliberately not the `xlsx` package, which has open,
  unfixed prototype-pollution/ReDoS advisories relevant to parsing
  untrusted uploads) → `chunk.ts` (paragraph-aware sliding window with
  overlap) → `src/lib/ai/embeddings.ts` (Gemini `embedContent`,
  `gemini-embedding-001`, truncated to 768 dims) → `document_chunks`
  (pgvector, HNSW cosine index) via `src/lib/db/chunks.ts`.
  `extraction_status`/`extraction_error` track per-document outcome;
  failures (corrupt file, scanned image-only PDF, embedding API down)
  are recorded on the row, never thrown past `processDocument()`.
- **Retrieval + context assembly**: `src/lib/ai/context-manager.ts`'s
  `buildContext()` implements the layered context from spec §10
  (project profile, current section, retrieved excerpts, requested
  sources, recent conversation turns) with token-budget-aware pruning.
  Wired into `/api/ai/*` in Phase 4 (§2d).
- **New data access**: `src/lib/db/{sections,messages}.ts` (new),
  `chunks.ts` (new), `citations.ts` extended with `getCitationsByIds()`
  — all needed by `buildContext()`.
- **A real runtime bug caught only by hitting the route, not by
  typecheck/lint/build**: `pdf-parse`'s `pdfjs-dist` dependency breaks
  under Next's RSC webpack bundling (`Object.defineProperty called on
  non-object`) unless listed in `next.config.ts`'s
  `serverExternalPackages`. `tsc`, `eslint`, and `next build` all passed
  while this was broken — worth remembering before treating a clean
  build as proof a new server-only dependency works at runtime.
- **57 new unit tests** (98 total): chunking (including a real bug this
  caught — `.slice(-0)` returning the whole string instead of empty in
  JS, silently bloating every chunk when `overlapChars` was 0),
  extraction (mocked libraries), the processing pipeline (mocked,
  including every failure path), context assembly and pruning order,
  and the new DB modules.
- **Not built in Phase 3**: background job processing for uploads (see
  the RAG doc for why synchronous is the deliberate current tradeoff),
  wiring `/api/ai/*` to `buildContext()` (Phase 4), true conversation
  summarization (recent-turns is a pragmatic stand-in), OCR for
  scanned PDFs, and citation *validation* (the table + CRUD exist, but
  nothing checks an AI-generated citation against it yet — Phase 5).

## 2d. What exists now (Phase 4)

Full detail lives in
[`AI_UI_ARCHITECTURE.md`](./AI_UI_ARCHITECTURE.md). Summary:

- **A real, working UI** for the first time — auth pages, project
  dashboard, and a three-pane project workspace (Research Navigator /
  Section Editor / AI Copilot), plus a document-management slide-over.
  Previous phases were foundation/data/pipeline layers with no UI to
  click through.
- **Auth**: Supabase email/password (not magic links — those need email
  delivery configured before anything's testable locally), session
  refresh + route protection via `middleware.ts`.
- **`buildContext()` is now actually called** — the gap flagged at the
  end of Phase 3. `src/lib/ai/prepare-request.ts`'s
  `resolveRequestContext()` builds context from a request's
  `sectionId`/`message`/`documentIds`/`sourceIds`/`conversationId` when
  the caller doesn't supply one directly; both `/api/ai/*` routes use it.
- **Explicit project-ownership checks added to `/api/ai/*`** — the other
  gap flagged since Phase 1 ("RLS stops it, but the route doesn't check,
  so failures are confusing rather than actually insecure"). Both routes
  now 404 on a `projectId` the caller doesn't own, before doing anything
  else.
- **Conversation persistence**: `/api/ai/chat` creates/reuses an
  `ai_conversations` row and persists both sides of each turn to
  `ai_messages`, using the `X-Conversation-Id` response header to hand
  the id back across a streaming response.
- **New API routes**: `/api/research/projects` (list/create),
  `/api/research/projects/[id]` (get/update/delete),
  `/api/research/projects/[id]/sections` (list),
  `/api/research/projects/[id]/sections/[type]` (get/upsert) — closing
  the "projects CRUD routes not built" gap from Phase 2.
- **Two real bugs found only by running the app in a browser**, not by
  `tsc`/`eslint`/`next build` (all three passed while both were live):
  middleware crashed on *every* request (including `/login`) when
  Supabase env vars are unset, because client construction throws
  synchronously and nothing caught it; the login/signup forms hung on
  "Signing in…" forever under the same condition, for the same reason
  (an uncaught throw inside an async handler). Both fixed — see the UI
  doc for the exact mechanism and fix.
- **5 new unit tests** (103 total) for `resolveRequestContext`, the one
  piece of new non-UI logic this phase. The UI itself was verified by
  running the dev server and interacting with it in a browser, not
  component tests — no testing-library/react setup exists yet (a
  reasonable follow-up once the component layer grows further, not
  needed for this pass).
- **Not built in Phase 4**: structured per-task action buttons (Improve/
  Explain/Cite/etc. from spec §23 — only free-form chat exists),
  resuming a past conversation on reload, version history/undo for
  AI-inserted content, citation insertion UI, and — importantly — any
  end-to-end verification against a real Supabase project. Everything
  here was checked against the *absence* of credentials; the actual
  golden path (sign up → create project → chat → get a real AI response
  → see it persist) has not been run against live infrastructure.

## 2e. What exists now (Phase 5)

Full detail lives in
[`AI_RESEARCH_INTELLIGENCE.md`](./AI_RESEARCH_INTELLIGENCE.md) and the
updated [`AI_RESEARCH_INTEGRITY.md`](./AI_RESEARCH_INTEGRITY.md). Summary:

- **Real structured AI output**: `AIRequest.responseSchema` flows through
  `AIOrchestrator` to both providers' native JSON-schema modes (Gemini's
  `responseSchema`, OpenAI's `json_schema` strict mode) — one schema
  definition per response shape, adapted per-provider by
  `toGeminiSchema()`, not two hand-maintained dialects.
- **Alignment Engine** (`checkAlignment()`) and **Quality Checker**
  (`runQualityCheck()`, behind `POST /api/research/projects/[id]/quality-check`
  and a workspace panel) — the first genuinely new AI-driven analysis
  capability since Phase 1's chat/generate primitives.
- **The integrity guard is now partly code, not just prompt** — closing
  the gap flagged in Phase 1's `AI_RESEARCH_INTEGRITY.md`: a
  results/analysis request with no dataset never reaches a model at all
  (`requiresDataset()`), and citations in `[key]` form are checked
  against real stored sources (`verifyCitationKeys()`). Both are real,
  bounded code checks, not a complete solution to "never fabricate" —
  see the intelligence doc's explicit gap list for what's still
  prompt-only.
- **A real ordering bug found via the local Supabase instance, not
  mocks**: both `/api/ai/*` routes built context (which embeds the query
  — real, billable work) *before* checking whether the dataset guard was
  about to block the request anyway. Fixed by checking the guard first
  in both routes, independent of the check already inside
  `AIOrchestrator`. Verified for real: the guard path needs no AI
  provider credentials (it never reaches a provider), so this was tested
  end-to-end as an authenticated user against a real project — confirmed
  in both the non-streaming and streaming routes, including that
  conversation persistence still happens correctly for a blocked
  request.
- **17 new unit tests** (139 total): `toGeminiSchema()`, the dataset
  guard and citation verification (deterministic — thoroughly tested),
  `checkAlignment()`/`runQualityCheck()` (mocked orchestrator/db), and
  the orchestrator's guard wiring specifically (proving the provider is
  never called when the guard fires).
- **Not built in Phase 5**: claim extraction from unstructured prose (the
  citation check only catches bracket-form references; the dataset guard
  only catches the two task types that are definitionally about
  reporting real data — a fabricated number inside an ordinary chat
  response has no code-level check); verification of `EvidenceStatus`
  self-reporting against real sources; the full spec §32 "Quality Check
  Dashboard" categories beyond what's built (Data checks like sample-size/
  percentage-total consistency need real analysis results, which is
  Phase 7); alignment/quality output has not been checked against a real
  model, since no AI provider keys are available in this environment.

## 2f. What exists now (Phase 6)

Full detail lives in
[`AI_QUESTIONNAIRE_BUILDER.md`](./AI_QUESTIONNAIRE_BUILDER.md). Summary:

- **New schema**: `research_instruments` (name, validation status,
  source reference, adaptation notes) and `questionnaire_questions`
  (section label, objective/variable/construct mapping as text — see
  below, question text, response type, options, required, order), both
  with RLS following the established EXISTS-based ownership pattern.
- **Scoping decision, stated plainly**: objectives/variables are still
  free text in `research_sections` (a Phase 2 decision this phase didn't
  change) — each question maps to `objective_label`/`variable_label` as
  descriptive text, not a foreign key, since there's no structured
  objectives/variables entity to reference. Honest to the current state
  of the app rather than adding FKs to rows that don't exist.
- **AI generation** (`generateQuestionnaire()`) reuses Phase 5's
  structured-output infrastructure as-is — no new plumbing, just a new
  schema. Unlike the alignment engine/quality checker, a bad response
  here is never partially persisted: this writes new rows, so a schema
  failure throws and saves nothing, rather than degrading to a
  placeholder.
- **Validated Instrument Safety (spec §26) enforced twice**, not once: a
  Zod refinement at parse time, *and* a database `CHECK` constraint
  (`source_reference_required_unless_researcher_developed`) — verified
  for real against the local Supabase instance, both the failing and
  succeeding case, through the actual REST API.
- **Workspace UI**: the existing "Questionnaire / Instrument" section
  now renders a dedicated `QuestionnaireBuilder` instead of the generic
  textarea — the first section-specific editor in the app.
- **Fully verified against the real local Supabase instance**: all 9
  migrations (Phase 2-6) applied cleanly from a full reset; RLS and the
  CHECK constraint both confirmed via real cross-user requests; the
  complete UI → API → DB round trip exercised in a real browser session,
  including a forced AI-provider failure confirmed to persist nothing
  partial.
- **26 new unit tests** (165 total). **Not verified**: actual
  questionnaire *quality* — no real AI provider keys in this
  environment, so generation itself was only exercised through mocks
  plus one real (intentionally failing) request.

## 3. Explicitly out of scope for this pass (N/A / deferred)

These spec sections describe later phases and were **not** built now —
listed here so it's clear what "Phase 1 done" does and doesn't include:

- `ContextManager` (§10) is now built (`buildContext()`, Phase 3 — see
  §2c) but not yet called from `/api/ai/*` — those routes still take a
  `context` string directly from the request body rather than assembling
  it server-side. Wiring that is Phase 4, once there's a real UI caller
  that knows which `sectionType`/`query`/`conversationId` to pass.
- RAG pipeline, embeddings, chunk storage (§14) — **done** (Phase 3, §2c).
- Citation *persistence* — **done** (`research_citations` CRUD, Phase 2/3).
  Citation *validation* (checking an AI-generated citation against stored
  sources before presenting it as real) is still not built — Phase 5.
- Web grounding (§17) — flagged via `AI_ENABLE_WEB_GROUNDING` and
  `needsWeb` in the classifier, but no provider-side grounding tool is
  wired up.
- Alignment engine, questionnaire builder, data analysis, discussion/
  conclusion engines, export, admin analytics dashboard (§20, §25–34).
- Structured verification output (`ResearchValidationIssue[]`) — the
  dual-model reviewer pass in `orchestrator.ts` currently returns free
  text in `structuredData.verification.notes`, not a parsed, typed issue
  list. Upgrading this is Phase 5 work.

## 4. Reusable for later phases

- The `AIProvider` interface and both concrete providers are
  task-agnostic — Phase 2+ section generators (variables, questionnaire,
  results, discussion, ...) reuse `AIOrchestrator.generate()` as-is; they
  only need to (a) add a `TaskType` + prompt file, (b) register it in
  `prompts/index.ts`, and (c) pass a richer `context` string once
  `ContextManager` exists.
- `token-manager.ts`'s `UsageRecord` shape matches the `ai_usage` table
  (§4/§55) field-for-field (Phase 2) — persisting it is now just
  swapping `recordUsage()`'s body for an insert, not a redesign or a
  schema change.
- `request-schema.ts` is the natural place to extend validation as new
  fields (e.g. `mode`-specific payloads) are added.
- `buildContext()` (Phase 3) is already generic over any `sectionType`/
  `query`/`documentIds`/`sourceIds`/`conversationId` combination — Phase
  4's UI and later section generators call it as-is; it doesn't need
  extending per task type the way `prompts/*.ts` does.

## 5. Technical risks / known gaps

- **Model IDs and pricing in `.env.example`/`token-manager.ts` are
  point-in-time examples** (verified against provider docs during this
  build) and will drift — both providers ship new model generations
  frequently. Re-verify before relying on cost figures for budgeting.
- **`ai_usage` table exists (Phase 2) but nothing writes to it yet** —
  `recordUsage()` in `token-manager.ts` still only logs to stdout.
  `AIOrchestrator` doesn't currently hold a request-scoped Supabase
  client, so wiring this is a small but real follow-up, not just a
  schema gap anymore.
- ~~RLS policies are unverified~~ **Verified** (Phase 5, once Docker
  became available): `supabase start` locally, two real users through the
  real Auth API, real cross-user REST/RPC/storage requests — see
  "RLS verification" in `AI_DATABASE_SCHEMA.md`. **A real bug was found
  and fixed this way**: the earlier migrations enabled RLS and wrote
  policies but never `GRANT`ed base table access to the `authenticated`
  role, so every query was rejected outright regardless of policy
  correctness — invisible without a real database. pgvector/HNSW search
  was also confirmed working with a real 768-dim embedding, and the
  fix's `alter default privileges` clause prevents the same gap from
  recurring on tables added by future migrations.
- **Document processing is synchronous, with no background job queue**
  (Phase 3 — deliberate for now, see `AI_RAG_ARCHITECTURE.md`). A large
  upload means a slow HTTP response; a crashed request mid-processing
  leaves a document stuck at `extraction_status = 'processing'` rather
  than cleanly `'failed'`, with no automatic retry.
- **OCR is not implemented.** A scanned, image-only PDF extracts as
  empty/near-empty text via `pdf-parse` rather than erroring — it will
  silently produce zero or near-zero chunks instead of failing loudly.
- **Sandbox networking in this build environment was unreliable**
  (npm registry requests ranged from ~2 KB/s to ~100 KB/s, and the global
  npm cache had root-owned files from an unrelated prior issue). Neither
  affects the shipped code, but if `npm install` misbehaves again locally,
  try `npm cache clean --force` or point at a fresh `--cache` directory
  rather than assuming the lockfile/config is wrong.
- **No CI wired up.** `npm run typecheck`, `npm run lint`, and
  `npm test` all work locally but nothing runs them automatically yet.
- ~~No UI has been tested against a real Supabase project~~ **Partially
  closed** (Phase 5): with a real local Supabase running, the actual
  golden path — sign up, log in, land on the dashboard, open a real
  project, see real section content, edit it, watch the edit persist —
  was run for real, not just checked for graceful failure. That's where
  the Strict Mode autosave bug was found (see `AI_UI_ARCHITECTURE.md`).
  **Still not run**: the AI chat path (no real Gemini/OpenAI
  keys in this environment), document upload end-to-end (same reason),
  and the email-confirmation branch of signup (local dev auto-confirms).
  If real AI provider keys become available, verifying those is the
  remaining gap — not a full repeat of what's already confirmed working.

## 6. Recommended implementation sequence from here

Following the spec's phase order:

1. ~~Phase 2 — Research Projects~~ **done**: schema, RLS, data access
   layer, `/api/research/projects*` CRUD routes (§2b, §2d). Remaining
   loose end: wiring `recordUsage()` to `ai_usage` (table exists, write
   path doesn't — `AIOrchestrator` still has no request-scoped DB
   client).
2. ~~Phase 3 — Document & RAG~~ **done**: upload/extraction/chunking/
   embedding pipeline, retrieval, `ContextManager` (§2c). Remaining loose
   ends: background job processing, citation validation.
3. ~~Phase 4 — AI Copilot UI~~ **done**: three-pane workspace, auth,
   `buildContext()` wired into `/api/ai/*`, conversation persistence
   (§2d). The golden path (auth → dashboard → real project → real
   section edits persisting) has now been run for real against a local
   Supabase instance — see §2d's update. Remaining loose ends:
   structured per-task action buttons (Improve/Explain/Cite/etc. — only
   free-form chat exists), version history/undo for AI-inserted content,
   resuming a past conversation on reload.
4. ~~Phase 5 — Research Intelligence~~ **done**: alignment engine,
   quality checker, structured AI output, integrity guard upgraded from
   prompt-only to partly code-enforced (§2e). Remaining loose ends: see
   §2e's "not built" list — claim extraction from unstructured prose is
   the big one, and it's a genuinely large feature, not a quick follow-up.
5. ~~Phase 6 — Questionnaire Builder~~ **done**: instrument/question
   schema, AI generation reusing Phase 5's structured-output
   infrastructure, validated-instrument-safety enforced twice (Zod +
   DB CHECK), dedicated workspace UI (§2f). Remaining loose ends:
   editing/reordering questions in the UI, regenerating into an existing
   instrument, questionnaire export (Phase 9).
6. Phases 7–10 as scoped in the spec, each as its own reviewable slice.
   Phase 7 (Data Analysis) is the next one that assumes real
   infrastructure this build hasn't needed yet (a dataset
   upload/parsing pipeline) — expect it to be a bigger schema/pipeline
   lift than Phase 6 was, closer in scope to Phase 3.

Do not skip straight to a later phase — most of them (data analysis,
discussion engine) assume the project/document data model from Phases
2–3 exists.

**A capability that changed mid-project, worth remembering for later
phases**: a real Docker daemon and the Supabase CLI became available
partway through Phase 5, and were used to catch three real bugs since
(a missing `GRANT` blocking all RLS-protected queries; a context-
building/guard ordering bug; confirmed the Phase 6 CHECK constraint
actually fires) that mocked tests and manual review had all missed. If
Docker is still available for later phases, keep verifying against
`supabase start` rather than relying on mocks alone for anything
touching RLS, migrations, or request ordering — see
`AI_DATABASE_SCHEMA.md`'s "RLS verification" section for the pattern
(two real users via the local Auth API, real cross-user requests through
PostgREST/RPC/Storage). Remember to `supabase db reset` after adding new
migrations, not just `supabase start`, to actually re-run the full chain
from scratch.
