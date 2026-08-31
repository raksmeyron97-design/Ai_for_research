# AI Architecture

## Request flow

```
Client (chat/generate call)
  → POST /api/ai/generate  or  /api/ai/chat
      → requireUserId()                     [Supabase session check, 401 if none]
      → aiRequestSchema.safeParse(body)      [reject malformed input at the boundary]
      → new AIOrchestrator({ userId })
          → classifyTask(request)            [task-classifier.ts — cheap, rule-based]
          → resolveProvider(classification)  [router.ts — honors AI_ENABLE_* flags]
          → buildSystemInstruction(request)  [prompt-manager.ts: task prompt + integrity guard]
          → buildPrompt(request)             [context string + user message]
          → provider.generate() / .stream()  [providers/gemini.ts | providers/openai.ts]
              on failure → resolveFallback()  → retry once on the other provider
          → recordUsage(...)                 [token-manager.ts — always logged, success or fail]
          → needsVerification()?             → second-model review pass (opt-in / high-risk only)
      ← AIResponse { content, citations?, warnings?, sources?, provider, model, usage }
```

## Why this shape

- **One orchestrator, not per-feature AI code.** Every AI-touching feature
  (chat, section generation, quality check, ...) calls
  `AIOrchestrator.generate()`/`.stream()` with a normalized `AIRequest`.
  Nothing outside `src/lib/ai/` talks to `@google/genai` or `openai`
  directly — that keeps provider-specific SDK quirks out of route
  handlers and UI code, and means adding a third provider later only
  touches `providers/` + `router.ts`.
- **Classification before routing, routing before calling.** The
  classifier is pure/deterministic (`task-classifier.ts`) so picking a
  model tier never costs a model call itself. The router then turns that
  classification into an actual provider+model, which is the only place
  that reads `AI_ENABLE_GEMINI`/`AI_ENABLE_OPENAI`.
- **Fallback is explicit and bounded.** `withRetry()` retries a single
  provider call (timeout + backoff, only for errors marked retryable).
  If the primary provider fails outright, the orchestrator tries the
  other enabled provider exactly once, then gives up — no infinite retry
  loops, no silent hangs.
- **Verification is opt-in, not automatic.** Dual-model review
  (`attachVerification`) only runs for tasks on an explicit high-risk
  list (`methodology_audit`, `quality_check`, `research_gap`) or when the
  caller sets `requireVerification: true`. Calling both providers on
  every request would double cost/latency for no benefit on routine
  tasks (spec §6).
- **The integrity guard is not a prompt suggestion, it's structural.**
  `buildSystemInstruction()` always appends
  `RESEARCH_INTEGRITY_INSTRUCTIONS` — there is no code path that builds a
  system instruction without it.

See [`AI_PROVIDER_ROUTING.md`](./AI_PROVIDER_ROUTING.md) for the tier
table and [`AI_RESEARCH_INTEGRITY.md`](./AI_RESEARCH_INTEGRITY.md) for the
integrity rules in detail.
