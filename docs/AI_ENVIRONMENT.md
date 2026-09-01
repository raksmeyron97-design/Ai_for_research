# Environment Variables

Copy `.env.example` to `.env.local` and fill in real values. Never commit
`.env.local`. All AI provider keys are server-only — nothing prefixed
`NEXT_PUBLIC_` should ever hold a secret.

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | yes | From your Supabase project settings. Safe for the browser. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Safe for the browser; RLS policies (Phase 2) are what actually restrict access, not this key. |
| `SUPABASE_SERVICE_ROLE_KEY` | only for admin jobs | Full-access key. Server-only. Do not use in a request-scoped client (`src/lib/supabase/server.ts` deliberately doesn't use it). |
| `GEMINI_API_KEY` | yes, if Gemini enabled | Server-only. |
| `OPENAI_API_KEY` | yes, if OpenAI enabled | Server-only. |
| `GEMINI_FAST_MODEL` / `GEMINI_STANDARD_MODEL` / `GEMINI_ADVANCED_MODEL` | no (defaults in `model-config.ts`) | Verify current model IDs at ai.google.dev before deploying — Gemini model generations rotate over months, not years. |
| `OPENAI_STANDARD_MODEL` / `OPENAI_REASONING_MODEL` / `OPENAI_REVIEWER_MODEL` | no (defaults in `model-config.ts`) | Same caveat, at platform.openai.com. |
| `GEMINI_EMBEDDING_MODEL` | no (default `gemini-embedding-001`) | Used by `src/lib/ai/embeddings.ts` for RAG (Phase 3). Verify at ai.google.dev — the previous embedding model (`text-embedding-004`) was fully deprecated in January 2026. |
| `GEMINI_EMBEDDING_DIMENSIONS` | no (default `768`) | **Must match** the `vector(N)` column width in `supabase/migrations/*_phase3_document_chunks.sql`. Changing this without a matching migration + full re-embed of existing documents breaks retrieval (dimension-mismatch errors on insert, not silently-wrong results). |
| `AI_DEFAULT_PROVIDER` | no | Currently informational; tier routing in `task-classifier.ts` decides the actual provider per request. |
| `AI_ENABLE_GEMINI` / `AI_ENABLE_OPENAI` | no (default `true`) | Set to `false` to force all traffic to the other provider. Both `false` throws `AIConfigError` at request time. |
| `AI_MAX_OUTPUT_TOKENS` | no (default `2048`) | Passed to every provider call — a hard cap, not a target. |
| `AI_MAX_CONTEXT_TOKENS` | no (default `32000`) | Enforced by `ContextManager` (`src/lib/ai/context-manager.ts`, Phase 3): once assembled context exceeds this token estimate, it prunes recent-conversation, then retrieved excerpts, then sources, then the current section — see `AI_RAG_ARCHITECTURE.md`. |
| `AI_ENABLE_WEB_GROUNDING` | no (default `false`) | Read by the classifier (`needsWeb`); no provider-side grounding tool is wired up yet, so this currently only affects the flag value in the response, not actual behavior. |
| `AI_ENABLE_FILE_SEARCH` | no | Reserved — not read anywhere yet. Phase 3's retrieval (`ContextManager`/`searchChunks`) doesn't gate on this flag; it's always active once a `query` is passed. |
| `AI_ENABLE_CITATION_VALIDATION` | no (default `true`) | Reserved for Phase 5 (validating AI-generated citations against `research_citations`). Not read anywhere yet. |
| `AI_MULTI_PROVIDER`, `AI_GEMINI_ENABLED`, `AI_OPENAI_ENABLED`, `AI_DOCUMENT_RAG`, `AI_WEB_RESEARCH`, `AI_QUALITY_CHECK`, `AI_DATA_ANALYSIS` | no | Feature flags from spec §58, present in `.env.example` for forward-compatibility with later phases. Not read anywhere yet except the `AI_*_ENABLED` pair being superseded by `AI_ENABLE_GEMINI`/`AI_ENABLE_OPENAI` above — keep both env var spellings until this is reconciled in Phase 2, don't remove either.

## Local dev without real provider keys

`AIOrchestrator` will throw `AIConfigError` (missing API key) as soon as a
request actually reaches a provider. There's currently no mock provider
for offline development — add one under `providers/` (implementing
`AIProvider`) if that's needed before real keys are available.
