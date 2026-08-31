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
- **Scope for this pass: Phase 0 + Phase 1 only**, then stop for review
  before touching research-project features (Phase 2+). The full spec is
  10 phases / 65 sections — realistically weeks of work — so it is being
  delivered incrementally with checkpoints rather than in one shot.

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

## 3. Explicitly out of scope for this pass (N/A / deferred)

These spec sections describe later phases and were **not** built now —
listed here so it's clear what "Phase 1 done" does and doesn't include:

- `ContextManager` layers 1–5 (§10) — currently `AIRequest.context` is a
  plain string the caller assembles; there is no project profile, no
  document retrieval, no conversation summarization yet. Building this
  for real requires the `ResearchProject`/`ResearchDocument` schema
  (Phase 2/3).
- RAG pipeline, embeddings, chunk storage (§14).
- Citation persistence/validation against real sources (§15–16) — the
  integrity guard prompts for it, but there's no `ResearchSource`/
  `ResearchCitation` table to check against yet.
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
- `token-manager.ts`'s `UsageRecord` shape is already close to the
  `AIUsage` table described in §4/§55 — persisting it is a schema
  migration + swapping `recordUsage()`'s body, not a redesign.
- `request-schema.ts` is the natural place to extend validation as new
  fields (e.g. `mode`-specific payloads) are added.

## 5. Technical risks / known gaps

- **No project-level authorization yet.** `/api/ai/*` routes check "is
  this user logged in," not "does this user own `projectId`." This is a
  real gap for the multi-tenant project-isolation requirement (§39) and
  must be closed as part of Phase 2 (RLS policies keyed on `project_id`,
  or an explicit ownership check in each route) before any real project
  data flows through these routes.
- **Model IDs and pricing in `.env.example`/`token-manager.ts` are
  point-in-time examples** (verified against provider docs during this
  build) and will drift — both providers ship new model generations
  frequently. Re-verify before relying on cost figures for budgeting.
- **No persistence for token usage yet** — `recordUsage()` logs to
  stdout. Fine for local dev, not for the admin analytics dashboard
  (§38, §55); needs an `AIUsage` table.
- **Sandbox networking in this build environment was unreliable**
  (npm registry requests ranged from ~2 KB/s to ~100 KB/s, and the global
  npm cache had root-owned files from an unrelated prior issue). Neither
  affects the shipped code, but if `npm install` misbehaves again locally,
  try `npm cache clean --force` or point at a fresh `--cache` directory
  rather than assuming the lockfile/config is wrong.
- **No CI wired up.** `npm run typecheck`, `npm run lint`, and
  `npm test` all work locally but nothing runs them automatically yet.

## 6. Recommended implementation sequence from here

Following the spec's phase order:

1. **Phase 2 — Research Projects**: `ResearchProject` + related tables in
   Supabase, RLS policies for project isolation, project CRUD API, the
   compact "research profile" JSON (§12), close the authorization gap
   noted above.
2. **Phase 3 — Document & RAG**: upload endpoint, text extraction,
   chunking, embeddings, `ContextManager` layers, source/citation tables.
3. **Phase 4 — AI Copilot UI**: the three-pane workspace (§34), wiring
   the existing `/api/ai/*` routes to a real editor with Insert/Replace/
   Regenerate controls (§42).
4. Phases 5–10 as scoped in the spec, each as its own reviewable slice.

Do not skip straight to a later phase — most of them (questionnaire
builder, data analysis, discussion engine) assume the project/document
data model from Phases 2–3 exists.
