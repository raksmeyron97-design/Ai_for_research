# Phase 16A — Pre-Benchmark Production Hardening

**Benchmark readiness: `PASS`** — the production AI path is fit to be measured.
No paid benchmark was run in this phase.

**Commit base:** `68aa3fa` · **Date:** 2026-09-01 · **Tests:** 603 passing (was 502)

Phase 16 built a benchmark harness and found eleven defects. Four affecting
production were fixed in Phase 16 (F1, F2, F3, F6). This phase closes the
remainder, plus one defect the F1 work uncovered, so that the first live
benchmark measures code worth measuring rather than known bugs.

| Gate | Result |
| --- | --- |
| `npm test` | `PASS` — 61 files, 603 tests |
| `npm run lint` | `PASS` — 0 errors, 0 warnings |
| `npm run typecheck` | `PASS` |
| `npm run build` | `PASS` — compiled in 21.4s |
| Offline benchmark harness (`ai:benchmark:dry`) | `PASS` — 366 MOCKED executions, run marked `complete` |
| Paid benchmark executed | **No** — out of scope for this phase |

---

## 1. F11 — citation false positives · `PASS`

**Root cause.** `extractCitationKeys` matched any bracket token
(`/\[([a-zA-Z0-9_-]+)\]/`), so ordinary list numbering was indistinguishable
from a citation. A model writing

```
[1] First point
[2] Second point
```

produced two "citation does not match any saved source" warnings. Latent for
several phases — then F3 started appending citation warnings to the chat
answer itself, which turned a silent false positive into text the researcher
reads. The severity came from the interaction, not from either change alone.

**Fix.** A citation-key grammar (`isCitationKeyShaped`): starts with a letter,
at least three characters, `[A-Za-z0-9_-]` only. But a grammar alone is wrong
in both directions, so verification is now two-stage:

1. Key-shaped tokens are candidates — warned about when they resolve to no
   saved source. Invented keys are still caught, so strictness is unchanged.
2. Non-key-shaped tokens (`[1]`) are *still looked up*, but never warned
   about. A project that genuinely keys a source `"1"` has its reference
   honoured — the grammar filters candidates, it does not overrule the
   database. If it resolves to nothing, it is list numbering and is ignored.

**Tests added.** `src/lib/ai/__tests__/citation-grammar.test.ts` — 26 cases
covering the required valid set (`[smith2024]`, `[WHO2025]`, `[abc_2024]`), the
required invalid set (`[1]`, `[2]`, `[10]`), the mixed list from the brief, a
fabricated key inside a numbered list, a stored key that fails the grammar, and
verification-failure handling.

**Residual risk.** A prose bracket that *is* key-shaped — `[Note]`, `[Figure]`
— still counts as a candidate and would warn. Lower frequency than bare
numbering, and unlike numbering it is at least plausible as a key. Not fixed.

---

## 2. Streaming idle-gap timeout · `PASS`

**Root cause.** `AIOrchestrator.stream()` called the provider adapter
directly, bypassing `withRetry` entirely. The F1 fix gave `generate()` a real
timeout; `stream()` had none at all, so a stalled provider connection held a
request handler open indefinitely. Not in the original numbered findings —
found while fixing F1.

**Fix.** `src/lib/ai/stream-guard.ts` wraps the provider stream in an
**idle-gap** timeout: the clock measures time since the last chunk and resets
on every one. A long answer that keeps producing tokens never trips it; a
connection that goes quiet does. A total-duration budget would have been the
wrong shape — it kills exactly the long generations users value while still
letting a stalled socket hold a handler for the full budget.

Configurable via `AI_STREAM_IDLE_TIMEOUT_MS`, default **60,000 ms**. The
default is deliberately generous because the riskiest window is *before* the
first chunk: a reasoning model can be silent for a while before emitting.

On timeout the guard aborts an `AbortController` whose signal both adapters
forward to their SDK, so the in-flight HTTP request is genuinely cancelled.

**Fallback rule.** Fallback after a stall is allowed **only when nothing has
been emitted yet**. Once a chunk has reached the client, restarting on another
provider would replay the answer from the start and duplicate text the reader
already has; the failure is reported instead. Both the failed attempt and any
fallback attempt are recorded in `ai_usage`, and a stall is never recorded as
a partial success.

**A bug the tests caught.** The first implementation `await`ed
`iterator.return()` during cleanup. On a stalled generator that does not settle
until the generator's own pending await resolves — so cleanup blocked for
exactly as long as the stall being timed out, defeating the guard. Cleanup is
now signalled, not awaited; the abort is what cancels the request.

**Tests added.** `stream-idle-timeout.test.ts` (12) and `stream-fallback.test.ts`
(9): normal stream, slow-but-continuous stream that outlives the budget in
total but never in a single gap, stalled stream, stall before any first chunk,
provider error after partial output, fallback when nothing was emitted,
*no* fallback once output was emitted, no fallback available, cleanup of
timers and readers, no duplicated chunks, and same-tier fallback model choice.

---

## 3. F10 — centralized safe JSON parsing · `PASS`

**Root cause.** Three raw `JSON.parse` sites, each with its own try/catch and
its own failure behaviour, and no shared notion of *why* a parse failed. Also
no tolerance for a markdown code fence, which a provider may emit even under a
structured-output schema.

**Fix.** `src/lib/ai/parse-ai-json.ts` — `parseAIJson({ raw, schema, task })`
returns a discriminated result (`empty` / `not_json` / `schema_mismatch`), and
`parseAIJsonOrThrow` for callers that must abort. It never returns partial or
repaired data, and its messages never echo raw model output back to a
researcher. Task-specific behaviour is preserved deliberately, because these
three failures genuinely differ:

| Caller | Behaviour on bad output |
| --- | --- |
| `quality-check.ts` | Controlled failure. Now also sets `scoresAvailable: false`, and the panel renders "no scores were produced" instead of zeros — a failed scorer and a project scoring 0 had been the same shape on screen. |
| `alignment-engine.ts` | Controlled "did not complete". Reported as a `medium` issue, because an empty issue list is indistinguishable from a clean bill of health. |
| `questionnaire-generator.ts` | Hard failure, nothing persisted. It writes instrument and question rows, so a partially valid response must abort before any insert. |

**Tests added.** `parse-ai-json.test.ts` — 16 cases: valid JSON, malformed
JSON, valid JSON with wrong schema, missing required fields, extra properties
(passthrough and strict), `null`, empty string, whitespace-only, fenced JSON
with and without a language tag, no-partial-data, and no raw output in
messages.

---

## 4. F9 — cost-aware fallback routing · `PASS`

**Root cause.** One model per tier, so `resolveFallback` had nothing same-tier
to reach for when the other provider was not that tier's owner, and fell
through to `getTierConfig("advanced")`. A failed `rewrite` — the cheapest task
in the app — landed on the reasoning model.

With the pricing verified in §6, the size of that mistake is now concrete:
`gemini-3.5-flash-lite` ($0.30 / $2.50 per 1M) failing over to `gpt-5.6`
→ `gpt-5.6-sol` ($4.00 / $20.00). **13x input, 8x output**, silently.

**Fix.** A model matrix of (tier × provider) in `model-config.ts`; fallback
preserves the tier and only changes provider. Primary provider per tier is
unchanged, so nothing re-routes — this adds the counterpart cell.

A cell has three states: unset (use the default), set, and **explicitly
blanked** (`OPENAI_FAST_MODEL=`), which declares "this provider has nothing
suitable at this tier" and disables fallback there rather than substituting a
differently-priced model. `resolveFallback` returns null in that case and the
original failure is reported.

**No infinite loops:** with two providers the fallback graph is a 2-cycle, and
callers attempt exactly one fallback, so there is no chain to enter.

**Tests added.** `fallback-routing.test.ts` — 18 cases: Gemini→OpenAI and
OpenAI→Gemini for all four tiers, the specific F9 regression (simple must not
resolve to the advanced model), disabled provider, blanked cell, no
self-fallback, single-step-only, and `resolveProvider` with a disabled primary.

---

## 5. F4/F5 — dead configuration · `PASS`

Each flag was resolved as **A: wire it up** or **B: delete it**. Nothing was
given fake functionality to justify its existence.

| Flag / field | Verdict | Action |
| --- | --- | --- |
| `needsWeb`, `needsDocuments`, `needsData`, `needsCitations` | B | Removed from `TaskClassification`, `classifyTask` and `TASK_META`. Computed on every request; read by nothing; no adapter ever passed a grounding or file-search tool. |
| `AI_ENABLE_WEB_GROUNDING` | B | Removed. Fed only `needsWeb`. |
| `AI_DEFAULT_PROVIDER` | B | Removed. Routing is decided by the tier table; the getter was never called. |
| `AI_ENABLE_FILE_SEARCH` | B | Removed. No file-search implementation exists. |
| `AI_ENABLE_CITATION_VALIDATION` | B | Removed. Citation verification is an integrity control and should not be switchable off; it was never consulted anyway. |
| `AI_MULTI_PROVIDER`, `AI_GEMINI_ENABLED`, `AI_OPENAI_ENABLED`, `AI_DOCUMENT_RAG`, `AI_WEB_RESEARCH`, `AI_QUALITY_CHECK`, `AI_DATA_ANALYSIS` | B | Removed from `.env.example`. Never read by any code. |
| `GEMINI_ADVANCED_MODEL`, `OPENAI_STANDARD_MODEL` | **A** | Now read — they are cells in the F9 fallback matrix. |
| `AI_ENABLE_GEMINI`, `AI_ENABLE_OPENAI` | **A** | Kept. Real provider kill switches, genuinely consulted. |

Web grounding and file search were **not** implemented. If either is on the
roadmap it should arrive as a feature with tool wiring, not as a flag.

---

## 6. F7 — pricing and cost accounting · `PASS`

### Verification

Rates read from the providers' own pages on **2026-09-01**:

- Gemini — <https://ai.google.dev/gemini-api/docs/pricing>
- OpenAI — <https://developers.openai.com/api/docs/pricing>
- OpenAI reasoning-token billing — <https://developers.openai.com/api/docs/guides/reasoning>
- OpenAI model aliases — <https://developers.openai.com/api/docs/guides/latest-model>

| Model | Input /1M | Cached input /1M | Output /1M | Note |
| --- | --- | --- | --- | --- |
| `gemini-3.5-flash-lite` | $0.30 | $0.03 | $2.50 | Output includes thinking tokens |
| `gemini-3.6-flash` | $0.75 | $0.075 | $3.75 | **Rises to $1.50 / $7.50 on 2027-01-01** |
| `gemini-embedding-001` | $0.15 | — | — | Input only |
| `gpt-5.6` → `gpt-5.6-sol` | $4.00 | $0.40 | $20.00 | Alias; see below |
| `gpt-5.6-terra` | $2.00 | $0.20 | $12.00 | |
| `gpt-5.6-luna` | $0.20 | $0.02 | $1.20 | |
| `gpt-5.5` | $5.00 | $0.50 | $30.00 | <272K context |
| `gpt-5.4` | $2.50 | $0.25 | $15.00 | <272K context |
| `gpt-5.4-mini` | $0.75 | $0.075 | $4.50 | |

**How wrong the old table was.** `gemini-3.6-flash` was listed at $0.075 input
against a real $0.75 (**10x**); `gemini-3.5-flash-lite` at $0.08 output against
a real $2.50 (**31x**). Every unlisted model was charged at an invented
`DEFAULT_RATE`. The admin dashboard summed all of it and presented it as a
total.

### Provider billing semantics — not "input + output"

Getting this wrong mis-bills every reasoning call, and the two providers differ:

- **Gemini**: `candidatesTokenCount` *excludes* `thoughtsTokenCount` (the SDK
  documents `totalTokenCount` as prompt + candidates + toolUsePrompt +
  thoughts), while the pricing page states output pricing "includes thinking
  tokens". Thinking tokens are therefore **added to output** before costing.
- **OpenAI**: `output_tokens` *already includes*
  `output_tokens_details.reasoning_tokens` — the reasoning guide's own example
  shows 1024 reasoning inside 1186 output. Adding them again would
  **double-count**.
- **Cached input** is a discounted rate on a *subset* of input tokens, not an
  extra charge; cached tokens are subtracted from the full-price count.

### Refusing to present unverified cost

`src/lib/ai/pricing.ts` carries each rate with its `source`, `verifiedOn`, and
where applicable `effectiveUntil`. A model with no rate — or whose rate has
expired — yields `costConfidence: "unverified"` and **no dollar fields at all**.
`calculateCost` returns `null` rather than a guess.

`ai_usage` gains `cost_confidence` (migration
`20260901080000_phase16a_cost_confidence.sql`, default `'unverified'` — the
honest value for every pre-existing row). Cost now has two independent sources
of doubt, both visible: `tokens_measured` (did the provider report the counts?)
and `cost_confidence` (do we have a verified price?). The dashboard's headline
figure is `authoritativeCostUsd` — only calls where **both** hold — and it
states what fraction of calls that covers.

`gemini-3.6-flash`'s scheduled increase is encoded as `effectiveUntil:
2026-12-31`, so on 2027-01-01 the rate expires and cost degrades to
"unverified" instead of silently applying a stale price.

**Tests added.** `pricing.test.ts` — 16 cases including Gemini thinking tokens
added to output, OpenAI reasoning tokens *not* double-counted, cached-input
discount, cached-exceeds-input clamping, rate expiry, unpriced models, and the
tier price gap that made F9 expensive.

### Model alias risk — action recommended

`gpt-5.6` is an alias. OpenAI's model guide states it "routes requests to
`gpt-5.6-sol`", the most expensive member of a family spanning **20x**
($0.20/$1.20 for luna to $4.00/$20.00 for sol). The app's `advanced` **and**
`reviewer` tiers both default to that alias, so both quality checks and the
dual-model verification pass run on the flagship.

It is priced as sol, which is correct today. But an alias can be repointed by
the provider without any change here. **Pin an explicit variant** in
`OPENAI_REASONING_MODEL` / `OPENAI_REVIEWER_MODEL` if that choice should be
yours. This is a configuration decision, so it was documented rather than made.

---

## 7. Benchmark harness safety review · `PASS`

| Requirement | Status | Mechanism |
| --- | --- | --- |
| Live calls opt-in | `PASS` | `*.bench.ts` runs only under `vitest.benchmark.config.ts`; `npm test` cannot reach it |
| Default CI cannot spend | `PASS` | Default suite is `smoke`, and only explicit `ai:benchmark*` scripts invoke it |
| Request cap | `PASS` | `AI_BENCH_MAX_REQUESTS`, hard stop |
| Scenario cap | `PASS` | `AI_BENCH_MAX_SCENARIOS` |
| Cost cap | `PASS` | `AI_BENCH_MAX_COST_USD` |
| Timeout | `PASS` | Harness-owned `withTimeout`, not inherited from app retry logic |
| Failures recorded | `PASS` | Classified into the failure taxonomy, persisted |
| Skipped requests explicit | `PASS` | Recorded as `skipped: <reason>` |
| **Partial runs distinguishable** | `PASS` | **New**: report carries `completeness: complete \| partial` with planned/skipped counts and the ceiling that truncated it; the Markdown says `PARTIAL` above the scores |
| Results persisted safely | `PASS` | `latest.json` + `latest.md`; raw dumps git-ignored |
| Secrets never in results | `PASS` | `redact()` on every provider error; test asserts no fixture holds a key |

The harness now prices runs from the application's verified rates by default
(`verified_app_pricing`), with an operator rate file still overriding. A model
neither source prices contributes nothing to cost totals and is named in the
report caveats.

---

## 8. Files changed

**New (10):** `src/lib/ai/pricing.ts`, `src/lib/ai/parse-ai-json.ts`,
`src/lib/ai/stream-guard.ts`,
`supabase/migrations/20260901080000_phase16a_cost_confidence.sql`, and six test
files (`citation-grammar`, `parse-ai-json`, `fallback-routing`, `pricing`,
`stream-idle-timeout`, `stream-fallback`).

**Modified (21):** `integrity-guard.ts`, `model-config.ts`, `router.ts`,
`task-classifier.ts`, `orchestrator.ts`, `token-manager.ts`, `types.ts`,
`quality-check.ts`, `alignment-engine.ts`, `questionnaire-generator.ts`,
`admin/analytics.ts`, `api/ai/chat/route.ts`, `components/AdminDashboard.tsx`,
`components/QualityCheckPanel.tsx`, `.env.example`, four benchmark harness
files, and three existing test files updated for intentional behaviour changes.

**Test count:** 502 → 603 (+101).

---

## 9. Remaining risks

| Risk | Severity | Note |
| --- | --- | --- |
| `gpt-5.6` alias may be repointed by OpenAI | Medium | Priced as sol today. Pin an explicit variant to remove the dependency. |
| `gemini-3.1-pro-preview` has no published rate | Low | The advanced-tier Gemini fallback cell. Cost reports `unverified` for it — correct, but it is a gap. It is also a preview model. |
| `gemini-3.6-flash` price rises 2027-01-01 | Low | Encoded; the rate expires rather than going stale. Re-verify before then. |
| Key-shaped prose brackets (`[Note]`) | Low | Still counted as citation candidates. |
| 60s default idle timeout | Low | Bounded, but a stalled stream still holds a handler for up to a minute. Tune per deployment. |
| Rates verified once, on 2026-09-01 | Medium | Provider pricing changes. There is no automated re-verification; `verifiedOn` makes staleness visible but does not prevent it. |
| F2 linking UI has no automated coverage | Low | The API is tested; the React panel is not. |

---

## 10. Benchmark readiness

`PASS`. The defects that would have contaminated a live run are fixed:
routing no longer mis-tiers on failure, malformed output cannot become trusted
state, citation warnings no longer fire on numbered lists, streams cannot hang,
and cost is computed from verified rates with provider-correct billing
semantics.

Before running the paid benchmark:

1. Load provider credits — still the only blocker to measurement.
2. Decide whether to pin an explicit `gpt-5.6` variant (§6).
3. `npm run ai:benchmark:smoke` first — 9 calls, cents.
4. For the full comparison, raise the ceiling: the judge pass roughly doubles
   a 549-call run, and the 600 default would truncate it. Use
   `AI_BENCH_MAX_REQUESTS=1200 AI_BENCH_MAX_COST_USD=15`.

Phase 16B (the live benchmark) was **not** started.
