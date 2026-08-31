# AI Provider Routing

## Model tiers

Model IDs are never hard-coded in application code — they come from env
vars (`model-config.ts`), looked up by tier:

| Tier | Default provider | Env var | Used for |
|---|---|---|---|
| `simple` | Gemini | `GEMINI_FAST_MODEL` | `rewrite`, `summarize`, `translate`, `outline`, `citation`, `reference_formatting` — high-volume, low-complexity tasks |
| `standard` | Gemini | `GEMINI_STANDARD_MODEL` | `chat`, `objective_generation`, `research_question`, `methodology`, `literature_review`, most section drafting |
| `advanced` | OpenAI | `OPENAI_REASONING_MODEL` | `research_gap`, `methodology_audit`, `quality_check`, `data_analysis` — reasoning-heavy tasks |
| `reviewer` | OpenAI | `OPENAI_REVIEWER_MODEL` | second-pass verification only, invoked selectively |

Full task → tier mapping is `TASK_META` in `task-classifier.ts`.

## Fallback behavior

Two distinct fallback situations, handled differently:

1. **Provider disabled at the tier level** (`resolveProvider` in
   `router.ts`): if the tier's default provider is off
   (`AI_ENABLE_GEMINI=false` / `AI_ENABLE_OPENAI=false`), the router
   immediately uses the other enabled provider for that request.
   `AIConfigError` is thrown only when *both* are disabled — that's a
   deployment misconfiguration, not a runtime condition to route around.
2. **Provider call fails at runtime** (`resolveFallback`, invoked from
   `AIOrchestrator`): the primary provider is enabled and selected, but
   the actual API call errors (timeout, 5xx, etc.) after retrying once.
   The orchestrator then tries the other provider once. If that also
   fails, `AllProvidersFailedError` propagates and the API route returns
   `503`.

Neither path retries indefinitely — see `withRetry()` in `errors.ts`
(bounded retries, exponential backoff, timeout per attempt).

## Adding a new task type

1. Add the `TaskType` string to `types.ts` and `request-schema.ts`'s
   `TASK_TYPES` (keep them in sync — the schema is the runtime guard, the
   type is the compile-time one).
2. Add an entry to `TASK_META` in `task-classifier.ts` with its tier and
   `needsWeb`/`needsDocuments`/`needsData`/`needsCitations` flags.
3. Optionally add a specialized prompt file under `prompts/` and register
   it in `prompts/index.ts` — otherwise it uses `prompts/default.ts`.

## Adding a third provider

Implement the `AIProvider` interface (`types.ts`) in `providers/`, add it
to the `PROVIDERS` map in `router.ts`, and extend `otherProvider()`'s
two-provider assumption (it currently assumes exactly Gemini ↔ OpenAI as
the fallback pair) if a three-way fallback policy is needed.
