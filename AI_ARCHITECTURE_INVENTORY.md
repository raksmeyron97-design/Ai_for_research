# AI Architecture Inventory (Phase 16, Step 1)

**Method.** This document was produced by reading the code, not the docs. Where
`docs/AI_*.md` and the implementation disagree, the implementation is recorded
here and the disagreement is called out. Every claim below names the file it
came from.

**Commit audited:** `63f17e7` · **Date:** 2026-09-01
**Live verification:** both provider credentials authenticate (Gemini lists 52
models, OpenAI 118); all generation calls return 429 for depleted billing
credit, so no model behaviour was observed.
**SDKs installed:** `@google/genai` 2.19.0, `openai` 7.8.0, `next` 15.5.24,
`zod` 3.25.76, `vitest` 4.1.11 · **Node:** v24.15.0

---

## 1. The real production call path

```
Client component (AICopilot / SectionEditor / QuestionnaireBuilder / …)
  └─ POST /api/ai/chat            (streaming)   src/app/api/ai/chat/route.ts
     POST /api/ai/generate        (non-stream)  src/app/api/ai/generate/route.ts
     POST …/quality-check | …/instruments | …/discussion/generate | …/conclusion/generate | …/datasets/[id]/analyze
        ├─ requireUserId()                      src/lib/supabase/server.ts
        ├─ aiRequestSchema.safeParse()          src/lib/ai/request-schema.ts
        ├─ checkRateLimit()                     src/lib/security/rate-limit.ts
        ├─ getProject() ownership check         src/lib/db/projects.ts
        ├─ resolveRequestContext()              src/lib/ai/prepare-request.ts
        │    └─ buildContext()                  src/lib/ai/context-manager.ts
        │         ├─ getProject / getSection / getCitationsByIds / getRecentMessages
        │         └─ embedQuery() → searchChunks()   src/lib/ai/embeddings.ts, src/lib/db/chunks.ts
        └─ AIOrchestrator.generate() | .stream()     src/lib/ai/orchestrator.ts
             ├─ classifyTask()                  src/lib/ai/task-classifier.ts
             ├─ resolveProvider()               src/lib/ai/router.ts
             ├─ requiresDataset() hard block    src/lib/ai/integrity-guard.ts
             ├─ buildSystemInstruction() / buildPrompt()   src/lib/ai/prompt-manager.ts
             ├─ withRetry(provider.generate)    src/lib/ai/errors.ts
             │    └─ GeminiProvider | OpenAIProvider      src/lib/ai/providers/
             ├─ recordUsage()                   src/lib/ai/token-manager.ts → ai_usage table
             ├─ attachVerification() (rare)     second-model review pass
             └─ detectPromptInjection()         src/lib/ai/prompt-injection-guard.ts
```

`AIOrchestrator` has **no** database client of its own. Context assembly is the
caller's job; the orchestrator receives a pre-built `AIRequest.context` string.

## 2. Provider abstraction

| Concern | Where | Notes |
| --- | --- | --- |
| Interface | `src/lib/ai/types.ts` → `AIProvider` | `generate` required; `stream` and `countTokens` optional |
| Gemini | `src/lib/ai/providers/gemini.ts` | `models.generateContent` / `generateContentStream` / `countTokens` |
| Gemini client | `src/lib/ai/gemini-client.ts` | Module-level singleton `GoogleGenAI`, built on first use |
| OpenAI | `src/lib/ai/providers/openai.ts` | `responses.create` (Responses API, not Chat Completions); module-level singleton |
| Key read | `src/lib/ai/model-config.ts` → `requireApiKey()` | **The only place** either key is read |
| Structured output | `src/lib/ai/json-schema.ts` | One JSON Schema per call, uppercased for Gemini's OpenAPI dialect |

Both clients are cached in module scope, so the **first** request's environment
fixes the key for the process lifetime.

## 3. Model selection and routing

Model ids are configuration, never literals in logic (`model-config.ts`).

| Tier | Provider | Env var | Fallback literal |
| --- | --- | --- | --- |
| `simple` | gemini | `GEMINI_FAST_MODEL` | `gemini-3.5-flash-lite` — verified served |
| `standard` | gemini | `GEMINI_STANDARD_MODEL` | `gemini-3.6-flash` — verified served |
| `advanced` | openai | `OPENAI_REASONING_MODEL` | `gpt-5.6` — verified served (see note) |
| `reviewer` | openai | `OPENAI_REVIEWER_MODEL` | `gpt-5.6` — verified served (see note) |

> **Note on `gpt-5.6`.** It is absent from the 118 ids `models.list` returns for
> this key, yet a Responses call to it is accepted and reaches the billing check
> (429), whereas a bogus id is rejected first with `400 ... does not exist`.
> The 400 precedes the 429, so the model resolves. `models.list` is therefore
> **not** an authority on what a key can call — providers serve unenumerated
> aliases. Any tooling that filters configured models against that list will
> silently drop working ones.
| embeddings | gemini | `GEMINI_EMBEDDING_MODEL` | `gemini-embedding-001` @ 768 dims |

Routing is a static table (`task-classifier.ts` `TASK_META`), 30 task types →
tier. No model call is spent deciding which model to call. `router.ts` honours
`AI_ENABLE_GEMINI` / `AI_ENABLE_OPENAI` and provides both a disabled-provider
fallback and a runtime `resolveFallback()` used after a call fails.

## 4. Prompts

- `prompt-manager.ts` = task system instruction + always-on integrity rules.
- `research-integrity-guard.ts` — six non-negotiable rules injected into
  **every** system instruction: no invented data, no invented citations,
  evidence labelling (`VERIFIED` / `SOURCE_REQUIRED` / `USER_PROVIDED` /
  `INFERENCE` / `UNVERIFIED`), no results without a dataset, hedge when
  uncertain, and treat retrieved content as data rather than instructions.
- `prompts/` — 7 builders registered for 11 of 30 task types
  (`prompts/index.ts`); the other 19 fall through to
  `buildDefaultSystemInstruction`.
- Language handling lives in `prompts/default.ts`: respond in Khmer or English,
  keeping internationally recognised technical terms in English alongside the
  Khmer.

## 5. RAG pipeline

| Stage | Where |
| --- | --- |
| Identify | `research_documents.citation_id` → `research_citations`; set via `PATCH .../documents/[documentId]`, chosen in `DocumentsPanel` |
| Extract | `src/lib/documents/extract.ts` (pdf-parse, mammoth) |
| Chunk | `src/lib/documents/chunk.ts` |
| Embed | `src/lib/ai/embeddings.ts` — Gemini `embedContent`, `RETRIEVAL_DOCUMENT` / `RETRIEVAL_QUERY` |
| Store | `document_chunks`, `vector(768)`, HNSW cosine index |
| Search | `match_document_chunks()` RPC, `SECURITY INVOKER`, always filtered by `project_id`, returns each chunk's `citation_key` |
| Assemble | `context-manager.ts` — 5 layers, pruned newest-cheapest-first to `AI_MAX_CONTEXT_TOKENS` |

Retrieval failure is caught and degraded to "no excerpts" rather than failing
the request (`context-manager.ts:57-73`).

## 6. Citation handling

- Extraction: `integrity-guard.ts:extractCitationKeys()` — every `[token]` in
  the output.
- Verification: `verifyCitationKeys()` — checks those tokens against
  `research_citations` for the project; unmatched keys become `high`-severity
  warnings.
- **Call sites: four**, after the F3 fix — `quality-check.ts:42`,
  `discussion-generator.ts:63`, `/api/ai/chat` and `/api/ai/generate`.

## 7. Token accounting and cost

`token-manager.ts` writes one `ai_usage` row per call (success **or**
failure). Token counts come from provider usage metadata when present and fall
back to `estimateTokens()` (`length / 4`). `RATE_TABLE` is labelled a
placeholder in its own comment and covers 3 model ids; anything else silently
uses `DEFAULT_RATE`.

## 8. Reliability

| Mechanism | Where | Reality |
| --- | --- | --- |
| Retry | `errors.ts:withRetry` | 1 retry from the orchestrator, exponential backoff, retryable errors only |
| Timeout | `errors.ts:withRetry` | Signal forwarded to both SDKs, plus a `Promise.race` backstop; rejects with `AITimeoutError` (F1 fixed) |
| Cross-provider fallback | `router.ts:resolveFallback` | Gemini ⇄ OpenAI after a failed call |
| Dataset hard block | `integrity-guard.ts:requiresDataset` | `results_generation` / `data_analysis` with no `dataSetId` never reach a model |
| Rate limit | `security/rate-limit.ts` | Per user, DB-backed |
| Idempotency | `security/idempotency.ts` | DB-backed keys |

## 9. Database surface

`research_projects`, `research_sections`, `research_documents`,
`document_chunks`, `research_citations`, `research_instruments`,
`questionnaire_questions`, `research_datasets`, `ai_conversations`,
`ai_messages`, `ai_usage`, `rate_limits`, `idempotency_keys`. RLS policies in
the `*_rls_policies.sql` migrations.

## 10. Environment variables: declared vs. actually read

| Variable | Read in code? |
| --- | --- |
| `GEMINI_API_KEY`, `OPENAI_API_KEY` | yes — `model-config.ts` only |
| `GEMINI_FAST_MODEL`, `GEMINI_STANDARD_MODEL`, `OPENAI_REASONING_MODEL`, `OPENAI_REVIEWER_MODEL` | yes |
| `GEMINI_EMBEDDING_MODEL`, `GEMINI_EMBEDDING_DIMENSIONS` | yes |
| `AI_MAX_OUTPUT_TOKENS`, `AI_MAX_CONTEXT_TOKENS` | yes |
| `AI_ENABLE_GEMINI`, `AI_ENABLE_OPENAI` | yes |
| `AI_ENABLE_WEB_GROUNDING` | read, but the value it produces is never consumed (see F4) |
| `GEMINI_ADVANCED_MODEL`, `OPENAI_STANDARD_MODEL` | **no** |
| `AI_DEFAULT_PROVIDER`, `AI_ENABLE_FILE_SEARCH`, `AI_ENABLE_CITATION_VALIDATION` | getters exist; **nothing calls them** |
| `AI_MULTI_PROVIDER`, `AI_GEMINI_ENABLED`, `AI_OPENAI_ENABLED`, `AI_DOCUMENT_RAG`, `AI_WEB_RESEARCH`, `AI_QUALITY_CHECK`, `AI_DATA_ANALYSIS` | **no** — declared in `.env.example`, never read |

## 11. Findings

Ordered by consequence. Each is a code fact, not an inference.

### F1 — The provider timeout does not time out — *high* — **FIXED**
`errors.ts:withRetry` aborts a controller on `timeoutMs`, but
`providers/gemini.ts` and `providers/openai.ts` never accept or forward the
signal, and there is no `Promise.race`. A hung provider connection blocks the
orchestrator indefinitely; the orchestrator's `timeoutMs: 45_000` is inert.
*Fixed:* `ProviderGenerateRequest` gains `signal`; Gemini forwards it as
`config.abortSignal`, OpenAI as the `RequestOptions` second argument; the
orchestrator passes `withRetry`'s signal through. `withRetry` also races the
call against the timer, as a backstop for any path that drops the signal, and
rejects with a new `AITimeoutError`. Regression tests in
`src/lib/ai/__tests__/timeout-abort.test.ts`. Note Google's caveat: aborting is
client-side, so an aborted request may still be billed — we stop waiting, not
paying.

### F2 — Retrieved chunks carry no citable identifier — *high* — **FIXED**
`document_chunks` has no foreign key to `research_citations` and
`ChunkSearchResult` (`db/types.ts:226`) has no citation key, so
`context-manager.ts:formatChunks` labels excerpts `[1]`, `[2]`, …. Every task
prompt tells the model to cite "its exact `[citation_key]` from context", and
`verifyCitationKeys` checks bracket tokens against `research_citations`. A model
grounding on retrieved evidence therefore has **no key it can emit that would
verify** — it can only cite the separate "Relevant Sources" layer, which is
populated from `sourceIds` the caller passes explicitly, not from retrieval.
*Fixed:* migration `20260901060000_phase16_chunk_citation_link.sql` adds
`research_documents.citation_id` (nullable, `on delete set null`) and rebuilds
`match_document_chunks` to return `citation_key` via a LEFT JOIN through the
document. `ChunkSearchResult` carries the key; `context-manager.ts` labels each
excerpt `[citation_key]`, or `[excerpt N (source not linked)]` when the document
has no source — never an invented key, and the space inside those brackets keeps
`extractCitationKeys` from scraping the label back out. `PATCH
/api/research/projects/[projectId]/documents/[documentId]` links or unlinks a
document, rejecting a citation from another project. Verified against the live
local Postgres: linked chunks return their key, unlinked return null, the
function is still `SECURITY INVOKER`, and deleting a source leaves the document
and its chunks intact.

### F3 — Citation verification does not run on the main chat path — *high* — **FIXED**
`verifyCitationsInText` is called from `quality-check.ts` and
`discussion-generator.ts` only. `/api/ai/chat` (the AI Copilot) and
`/api/ai/generate` returned model output with no citation check.
*Fixed:* chat verifies the accumulated answer once the stream completes and
appends a `[Citation check: ...]` note to the same text stream (`AIChunk` has no
structured channel, and a key can only be checked once its sentence is
complete); generate attaches the warnings to `AIResponse.warnings`. Both are
best-effort — a verification that throws never turns a delivered answer into a
failure. Tests in `src/app/api/__tests__/ai-citation-verification.test.ts`.

### F4 — Web grounding and file search are configured but not implemented — *medium*
`TaskClassification.needsWeb` / `needsDocuments` / `needsData` /
`needsCitations` are computed in `task-classifier.ts` and consumed **nowhere**.
Neither adapter passes a grounding or file-search tool to its SDK. Setting
`AI_ENABLE_WEB_GROUNDING=true` changes a boolean nothing reads.

### F5 — Seven documented feature flags do nothing — *medium*
`AI_MULTI_PROVIDER`, `AI_GEMINI_ENABLED`, `AI_OPENAI_ENABLED`,
`AI_DOCUMENT_RAG`, `AI_WEB_RESEARCH`, `AI_QUALITY_CHECK`, `AI_DATA_ANALYSIS`
appear in `.env.example` under "Feature flags (Section 58)" and are read by no
code. An operator disabling `AI_DOCUMENT_RAG` in an incident would change
nothing while believing RAG was off. Same for `AI_DEFAULT_PROVIDER`: routing is
by tier table, so setting it to `openai` has no effect.

### F6 — Streamed responses have no provider token counts — *medium* — **FIXED**
`providers/gemini.ts:stream` and `providers/openai.ts:stream` yield text deltas
only and never surface `usageMetadata` / the final `response.completed` usage.
`orchestrator.stream()` therefore records `estimateTokens(text)` for every
streamed call. `/api/ai/chat` — the highest-volume route — is the streaming one,
so **the majority of `ai_usage` rows hold estimated, not measured, tokens.**

### F7 — Cost figures are placeholders — *medium*
`RATE_TABLE` carries 3 model ids with rates its own comment calls placeholders;
`gpt-5.4-mini` and every unlisted model fall to `DEFAULT_RATE`. Admin analytics
sums `estimated_cost_usd` from these numbers. Phase 16 reports no USD figure
unless an operator supplies verified rates.

### F8 — Reasoning and cached tokens were discarded — *medium* — **fixed in Phase 16**
Gemini reports `thoughtsTokenCount` and OpenAI reports
`output_tokens_details.reasoning_tokens` / `input_tokens_details.cached_tokens`.
`toUsage()` in both adapters dropped them, so for a thinking model
`inputTokens + outputTokens` did not reconcile with `totalTokens`. Phase 16 adds
`reasoningTokens` and `cachedInputTokens` to `TokenUsage` and populates both.
`calculateCost()` still bills input+output only, which under-counts for
reasoning models — that change is **recommended, not made**, because it alters
persisted `ai_usage` figures.

### F9 — Low-tier work can fall back to the most expensive model — *low*
`router.ts:resolveFallback`: when the fallback provider is OpenAI and the tier
is `simple` or `standard`, `getTierConfig("standard").provider` is `gemini`, so
the branch falls through to `getTierConfig("advanced").model`. A `rewrite` task
failing over lands on the reasoning model.

### F10 — Structured-output parsing has no code-fence tolerance — *low*
`quality-check.ts:114` and `questionnaire-generator.ts:117` call `JSON.parse`
on raw content. A provider that wraps JSON in a ```` ```json ```` fence produces
placeholder scores (quality check) or a hard failure (questionnaire). The
benchmark detects and reports this case separately.

### F11 — `extractCitationKeys` matches any bracket token — *low*
The regex `\[([a-zA-Z0-9_-]+)\]` also matches `[1]`, `[Note]`, `[i]`. Combined
with F2's `[1]`-numbered excerpts, a model that echoes an excerpt marker
produces a bogus "citation does not match any saved source" warning.

---

## 12. What Phase 16 changed in `src/`

**Measurement only** (Step 13 requires reasoning-token accounting; additive and
optional, no caller behaviour change, `calculateCost()` untouched):

- `types.ts` — `TokenUsage` gains `reasoningTokens`, `cachedInputTokens`.
- `providers/gemini.ts` — maps `thoughtsTokenCount`, `cachedContentTokenCount`.
- `providers/openai.ts` — maps `output_tokens_details.reasoning_tokens`,
  `input_tokens_details.cached_tokens`.

**Defect fixes** (F1, F2, F3 — see findings above):

- `types.ts` — `ProviderGenerateRequest.signal`; `db/types.ts` —
  `ChunkSearchResult.citation_key`, `ResearchDocumentRow.citation_id`.
- `errors.ts` — `AITimeoutError`, signal forwarding, race backstop.
- `providers/gemini.ts`, `providers/openai.ts` — forward the signal.
- `orchestrator.ts` — pass the signal through.
- `context-manager.ts` — label excerpts with their citation key.
- `api/ai/chat/route.ts`, `api/ai/generate/route.ts` — verify citations.
- `api/research/projects/[projectId]/documents/[documentId]/route.ts` — `PATCH`
  to link a document to its source.
- `api/research/projects/[projectId]/citations/route.ts` — `GET`/`POST` sources.
  New: nothing in the app wrote to `research_citations` before, so the picker
  would have offered an empty list forever.
- `components/DocumentsPanel.tsx` — per-document source control (pick an
  existing source, or create one from the file and link in a single step).
- `providers/gemini.ts`, `providers/openai.ts`, `orchestrator.ts`,
  `token-manager.ts`, `admin/analytics.ts`, `components/AdminDashboard.tsx` —
  streaming usage capture and measured/estimated reporting.
- `supabase/migrations/20260901060000_phase16_chunk_citation_link.sql`,
  `..._20260901070000_phase16_usage_tokens_measured.sql`.

Still open, and unchanged on purpose: **F7** (placeholder rates), F4/F5 (dead
config), F9, F10, F11. Also unaddressed: `AIOrchestrator.stream()` has no
timeout at all — the F1 fix covers `generate()` via `withRetry`, but the
streaming path calls the adapter directly, so a stalled stream still hangs.
