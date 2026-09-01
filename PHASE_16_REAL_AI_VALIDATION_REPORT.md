# Phase 16 — Real AI Validation & Benchmarking Report

**Status: `NOT READY`**

---

## Executive Summary

Phase 16 asked one question: *does the AI actually perform well enough for real
academic and thesis work?*

**That question is not answered by this report, and this report will not pretend
otherwise.** No live model call was made, because no provider credential exists
in this environment. `GEMINI_API_KEY` and `OPENAI_API_KEY` are present but empty
in `.env.local`, and absent from the shell environment. Both provider endpoints
are reachable from this machine — `https://generativelanguage.googleapis.com`
returns 403 and `https://api.openai.com/v1/models` returns 401, i.e. "who are
you", not "cannot connect" — so the block is **credentials only**. The moment a
key is supplied, the full suite runs with one command.

What Phase 16 *did* produce:

1. **A complete, executed audit of the shipped AI system** (`AI_ARCHITECTURE_INVENTORY.md`),
   which found 11 defects, four of them serious enough to affect production
   behaviour today. These are code facts, verified by reading the code and, in
   five cases, pinned by a regression test.
2. **A real benchmark harness** — 56 scenarios, 8 deterministic evaluators, a
   blind LLM-judge pass, cost/latency/token accounting, hard budget rails and
   machine-readable reporting — that calls the **production** prompt builders
   and provider adapters, not a parallel copy.
3. **109 tests over the harness itself**, plus a full 366-execution offline run
   proving the pipeline end to end.
4. **An honest machine-readable result** (`reports/ai-benchmark/latest.json`)
   recording `PROVIDER_UNAVAILABLE` for both providers, with zero synthesised
   data.

| | |
| --- | --- |
| Tested | AI provider abstraction, routing, prompts, RAG assembly, citation verification, token accounting, reliability, structured output, production safety |
| Live | **Nothing.** Both providers `UNAVAILABLE` |
| Mocked | 366 harness-validation executions against a deterministic stub |
| Unavailable | Gemini (no key), OpenAI (no key) |
| Providers/models tested | none |
| Overall result | Architecture measured; **model quality not measured** |

The status is `NOT READY` for the plainest possible reason: a system whose
answer quality has never been measured cannot be declared ready, and separately,
four measured defects (F1, F2, F3, F6) would need fixing regardless of how well
the models score.

---

## Environment

| Item | Value |
| --- | --- |
| Commit | `63f17e7` (local `main`, one commit ahead of `origin/main`) |
| Date | 2026-09-01 |
| Node | v24.15.0 |
| `@google/genai` | 2.19.0 — `models.generateContent` (Gemini Developer API) |
| `openai` | 7.8.0 — `responses.create` (Responses API) |
| `next` / `zod` / `vitest` | 15.5.24 / 3.25.76 / 4.1.11 |
| Benchmark suite version | 16.0.0 |
| Models executed | **none** |

### Provider status (measured, `reports/ai-benchmark/providers.json`)

| Provider | Status | Credential | Reachable | Models discovered | Reason |
| --- | --- | --- | --- | --- | --- |
| gemini | `UNAVAILABLE` | absent | not attempted | — | `GEMINI_API_KEY` is not set. No live call was attempted and no result was synthesised. |
| openai | `UNAVAILABLE` | absent | not attempted | — | `OPENAI_API_KEY` is not set. No live call was attempted and no result was synthesised. |

### On model IDs

`.env.example` names `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gpt-5.4-mini`
and `gpt-5.6`. **None of these were verified**, and this report does not treat
them as real. Model ids typed into an env file are configuration, not evidence.
`npm run ai:models` asks each provider which models the key can actually call,
and the runner drops any configured model the provider does not list, recording
it in the report. Every execution record stores the exact model id executed
alongside provider, SDK version, API mode and timestamp.

---

## Benchmark Design

**56 scenarios** (target was 30 minimum, 40–60 preferred).

| Category | n | | Language | n | | Difficulty | n |
| --- | --- | --- | --- | --- | --- | --- | --- |
| hallucination | 11 | | English | 49 | | hard | 27 |
| rag_grounding | 10 | | Khmer | 6 | | medium | 25 |
| methodology_reasoning | 8 | | mixed (km→en) | 1 | | easy | 4 |
| khmer_writing | 7 | | | | | | |
| academic_qa | 5 | | **RAG class** | **n** | | | |
| questionnaire | 5 | | Class 1 (answerable) | 5 | | | |
| english_writing | 3 | | Class 2 (partial) | 3 | | | |
| literature_synthesis | 2 | | Class 3 (unanswerable) | 4 | | | |
| structured_output | 2 | | Class 4 (adversarial) | 3 | | | |
| citation / summarization / thesis_outline | 3 | | | | | | |

31 scenarios require retrieval; 25 require citations.

### The fixture library

Two corpora — perinatal mental health (7 sources) and maternal nutrition
(5 sources) — in `tests/ai-benchmark/fixtures/corpus.ts`.

**Every source is fictional.** Titles, authors, journals, findings and numbers
were written for this benchmark. DOIs use the reserved `10.0000/` prefix, which
is not an assigned registrant, so nothing here can be mistaken for a resolvable
identifier (a test enforces this). No real or identifiable human-subject data
appears anywhere.

Fictional rather than real papers, deliberately: the benchmark needs ground
truth it fully controls — *exactly* which claims a source does and does not
support — so that "cited a real source that does not support the claim" is
detectable at all. Paraphrasing real studies would make the ground truth a guess
about the literature rather than a fact about the fixture.

The corpora include planted distractors (a night-shift sleep study with no
perinatal participants; a paediatric growth-monitoring study with no maternal
data) and a planted conflict pair (17.9% urban cohort vs 8.2% rural survey for
the same 6-week prevalence).

### Evaluation methodology

**Automated (deterministic, no model involved):**

| Evaluator | What it establishes |
| --- | --- |
| `citation` | Uses the *production* `extractCitationKeys`. Separates **correct** / **mismatched** (real source, wrong claim) / **fabricated** (exists in no corpus). "Citation present" is scored nowhere. |
| `grounding` | Numeric provenance: every figure asserted must appear in the retrieved evidence or an explicit allowance. Reports **not-evaluable** (not 100) when an answer asserts no figures, so evasion is not rewarded. |
| `abstention` | Phrase-level insufficiency markers, English and Khmer. Backed up by `mustNotContain` on every Class 3 scenario, so a response that says "no data" and then invents data still fails. |
| `conflict_detection` | Did it acknowledge that two sources disagree? |
| `false_premise` | Did it correct a wrong premise embedded in the question? |
| `forbidden_content` | Hard fail on specific forbidden strings (a dose, a `$` figure, a distractor's statistic). |
| `concept_coverage` | Required concepts as any-of groups; scored proportionally. |
| `structured_output` | Validated against the **production Zod schemas**, so a pass means the app could actually persist it. Markdown code fences are detected and reported separately (see F10). |
| `khmer_script` / `terminology_consistency` | Script ratio, English leakage, and whether a technical term is rendered identically each time. |
| `length` | Discipline against a per-scenario cap. Verbosity is never rewarded. |

**LLM-assisted:** a blind judge (`evaluators/llm-judge.ts`) scores the
dimensions code cannot check — citation entailment, reasoning quality, academic
usefulness, Khmer naturalness. It sees "Response A", never a provider name; it
is never the model that produced the response; and judge provider, model, prompt
version and criteria are recorded on every judgement. Judge scores are reported
as their own dimension and are never folded into the automated rubric.

### Rubric

Step 17 weights, unchanged: factual correctness 20, groundedness 15, citation
correctness 15, research reasoning 15, Khmer 10, hallucination resistance 10,
English 5, instruction following 5, conciseness 5.

Weights are **renormalised over the dimensions a scenario can actually
evaluate** — applying a Khmer weight to an English scenario would drag every
English score toward a constant and make the overall figure meaningless.
Category scores and per-RAG-class scores are always reported alongside the
overall, because a single average hides the classes that matter most: Class 1
rewards answering and Class 3 rewards refusing, so averaging them produces a
number that rises when a model gets better at one and worse at the other.

---

## Results

| Category | Gemini | OpenAI | Winner |
| --- | --- | --- | --- |
| Factual correctness | NOT MEASURED | NOT MEASURED | — |
| RAG groundedness | NOT MEASURED | NOT MEASURED | — |
| Citation correctness | NOT MEASURED | NOT MEASURED | — |
| Methodology reasoning | NOT MEASURED | NOT MEASURED | — |
| Khmer academic quality | NOT MEASURED | NOT MEASURED | — |
| English academic quality | NOT MEASURED | NOT MEASURED | — |
| Hallucination resistance | NOT MEASURED | NOT MEASURED | — |
| Token efficiency | NOT MEASURED | NOT MEASURED | — |
| Latency | NOT MEASURED | NOT MEASURED | — |
| Cost efficiency | NOT MEASURED | NOT MEASURED | — |

Every cell reads `NOT MEASURED` because `PROVIDER_UNAVAILABLE` applies to both
providers. No cell is filled with a placeholder, an estimate, or a value carried
over from another model.

### Harness validation (MOCKED — not a model result)

A 366-execution offline run against the deterministic stub proves the pipeline:
scenario → production prompt → adapter → response → 8 evaluators → rubric →
failure taxonomy → JSON + Markdown report.
Artifacts: `reports/ai-benchmark/harness-validation/`.

The stub is not a model and is not tuned to pass. It always abstains and never
asserts a figure. It scores **53.7 overall**, and the spread is the useful part
— it shows the evaluators discriminate rather than rubber-stamping:

| Category | Stub | Why |
| --- | --- | --- |
| structured_output | 100.0 | Emits schema-valid JSON |
| RAG Class 3 (must refuse) | 92.9 | Always abstaining is *correct* here |
| RAG Class 4 (adversarial) | 80.0 | Never uses the distractor — because it never reasons |
| rag_grounding | 68.8 | |
| questionnaire | 51.4 | |
| khmer_writing | 35.5 | Answers a Khmer prompt in English |
| methodology_reasoning | 21.5 | No reasoning content at all |

92 failures were classified: 62 `REASONING_FAILURE`, 12 `LANGUAGE_FAILURE`,
10 `CITATION_FAILURE`, 8 `HALLUCINATION` (8 critical, 10 high, 74 medium).

---

## Detailed Failure Analysis

No model failures exist to analyse. What follows are **measured defects in the
shipped AI system**, found by the Step 1 audit. Full detail and file:line
references in `AI_ARCHITECTURE_INVENTORY.md`.

### F1 — The provider timeout does not time out
**Severity:** high · **Reproducible:** yes (static)
**Observed:** `errors.ts:withRetry` creates an `AbortController` and passes the
signal to its callback, but `providers/gemini.ts` and `providers/openai.ts`
never accept or forward it, and there is no `Promise.race`.
**Expected:** a provider call exceeding `timeoutMs` is cancelled.
**Category:** `TIMEOUT` · **Cause:** the signal is created and dropped.
**Fix:** forward `AbortSignal` to both SDKs (both accept one), or race the call.
The orchestrator's `timeoutMs: 45_000` is currently inert; a hung connection
blocks indefinitely. The Phase 16 harness implements its own `withTimeout`
rather than inheriting this.

### F2 — Retrieved chunks carry no citable identifier
**Severity:** high · **Reproducible:** yes (pinned by a test)
**Observed:** `document_chunks` has no link to `research_citations`, and
`ChunkSearchResult` has no citation key, so `context-manager.ts:formatChunks`
labels excerpts `[1]`, `[2]`, ….
**Expected:** a model grounding on a retrieved excerpt can cite it in a form
that verifies.
**Category:** `CITATION_FAILURE` (architectural)
**Cause:** every task prompt instructs the model to cite "its exact
`[citation_key]` from context", and `verifyCitationKeys` checks bracket tokens
against `research_citations` — but retrieval provides no such key. The model can
only cite the separate "Relevant Sources" layer, populated from `sourceIds` the
caller passes explicitly, **not** from retrieval.
**Fix:** join chunks to their source and render the key on the excerpt. This is
the most consequential finding in the phase — it means the citation-verification
loop and the retrieval loop are structurally disconnected. It is also the reason
prompt tuning should not be attempted first: the model may not be failing to
cite, it may have nothing citable. The A/B (below) is built to settle this.

### F3 — Citation verification does not run on the main chat path
**Severity:** high · **Reproducible:** yes (static)
**Observed:** `verifyCitationsInText` is called from `quality-check.ts` and
`discussion-generator.ts` only. `/api/ai/chat` (the AI Copilot, the highest-
traffic surface) and `/api/ai/generate` return model output with no citation
check at all.
**Fix:** run verification on both routes; for the streaming route, verify the
accumulated text before persisting the assistant message.

### F6 — Streamed responses have no provider token counts
**Severity:** medium · **Reproducible:** yes (static)
**Observed:** both `stream()` implementations yield text deltas only and never
surface usage metadata, so `orchestrator.stream()` records
`estimateTokens(text)` (`length / 4`).
**Consequence:** `/api/ai/chat` is the streaming route, so **most `ai_usage`
rows — and therefore the admin analytics dashboard — hold estimated, not
measured, tokens.**
**Fix:** capture `usageMetadata` from the final Gemini chunk and the OpenAI
`response.completed` event.

### F7 — Cost figures are placeholders
**Severity:** medium
`RATE_TABLE` holds 3 model ids with rates its own comment calls placeholders;
everything else falls to `DEFAULT_RATE`. The admin dashboard sums these into
`estimated_cost_usd`. The Phase 16 harness refuses to print any USD figure
unless an operator supplies verified rates via `AI_BENCH_RATE_FILE`.

### F4 / F5 — Configuration that does nothing
**Severity:** medium
`TaskClassification.needsWeb` / `needsDocuments` / `needsData` /
`needsCitations` are computed and consumed **nowhere**; no grounding or
file-search tool is passed to either SDK. Seven documented feature flags
(`AI_MULTI_PROVIDER`, `AI_GEMINI_ENABLED`, `AI_OPENAI_ENABLED`,
`AI_DOCUMENT_RAG`, `AI_WEB_RESEARCH`, `AI_QUALITY_CHECK`, `AI_DATA_ANALYSIS`)
and `AI_DEFAULT_PROVIDER` are read by no code. An operator disabling
`AI_DOCUMENT_RAG` during an incident would change nothing while believing RAG
was off.

### F9 / F10 / F11 — Lower-severity
- **F9:** a failed `simple`-tier task falling over to OpenAI lands on the
  *reasoning* model, not a cheap one (`router.ts` tier-mapping fall-through).
- **F10:** `quality-check.ts` and `questionnaire-generator.ts` `JSON.parse` raw
  content; a markdown-fenced response yields placeholder scores or a hard
  failure.
- **F11:** `extractCitationKeys` matches any bracket token, so combined with
  F2's `[1]`-numbered excerpts, an echoed excerpt marker produces a bogus
  "citation does not match any saved source" warning.

---

## RAG Evaluation

**Retrieval relevance, groundedness, citation correctness, citation
completeness and unsupported-claim rate: NOT MEASURED** (no live provider).

Two things are worth stating anyway, because they are established without a
model:

1. **F2 is a hard ceiling on citation correctness for retrieval-grounded
   answers.** No prompt can make a model emit a verifying citation key that was
   never put in front of it.
2. **Retrieval itself was not exercised end to end.** The benchmark injects
   fixture evidence as `AIRequest.context` — the same string
   `context-manager.ts` would build — rather than running `embedQuery` →
   `match_document_chunks`, because embedding requires the same missing Gemini
   credential. So the harness measures *grounding and citation behaviour given
   evidence*, which is the part model choice affects. Vector-search recall is a
   separate measurement that needs a key and a populated project, and it is
   **not** claimed here.

The suite is structured for the measurement the moment a key exists: Class 1
(answerable, 5), Class 2 (partial, 3), Class 3 (unanswerable — must abstain, 4),
Class 4 (adversarial distractors, 3), each reported separately.

---

## Khmer Evaluation

**NOT MEASURED.**

7 Khmer-category scenarios are ready (6 Khmer-language, 1 Khmer→English):
concept explanation, English→academic Khmer translation with exact number and
hedge preservation, academic-register rewriting, a Khmer abstract from a
provided source, methodology explanation, Khmer→English academic prose, and a
terminology-consistency literature paragraph.

The automated evaluators cover script ratio, English leakage and terminology
drift. They deliberately **do not** score naturalness, register or academic
tone — a regex cannot rate those, and pretending otherwise would be exactly the
kind of unbacked claim this phase exists to remove. Those dimensions come from
the blind judge and from human review, and until a live run happens they are
simply unmeasured.

One implementation note that shaped the evaluator: Khmer has no inter-word
spaces, so a space-split word count is meaningless for it. `countWords` counts
Latin words as words and Khmer as 4-character units, so length caps apply to
Khmer answers instead of silently passing every one.

---

## Token and Cost Analysis

**Median input / output / total tokens, cost per request, quality-per-dollar:
NOT MEASURED.**

Established without a live run:

- **Reasoning tokens were invisible.** Gemini reports `thoughtsTokenCount`;
  OpenAI reports `output_tokens_details.reasoning_tokens` and
  `input_tokens_details.cached_tokens`. Both adapters discarded all three, so
  for a thinking model `inputTokens + outputTokens` did not reconcile with
  `totalTokens`. **Phase 16 fixed the capture** (three files, additive and
  optional) and pinned it with tests. `calculateCost()` still bills input+output
  only, which under-counts for reasoning models — that change is
  **recommended, not made**, because it alters persisted `ai_usage` values and
  belongs in a change with its own migration story.
- **Most production token counts are estimates, not measurements** (F6).
- **No verified pricing exists in this repository** (F7). The harness reports no
  USD figure at all rather than a plausible-looking one; supply
  `AI_BENCH_RATE_FILE` (template at `reports/ai-benchmark/pricing.example.json`)
  to get cost per request, cost per successful answer, and monthly projections
  at 100 / 1,000 / 5,000 requests per day.

The harness records `inputTokens`, `outputTokens`, `totalTokens`,
`reasoningTokens`, `cachedInputTokens`, harness-measured
`retrievedContextTokens` and `promptTokens` per execution, and flags whether
each came from the provider or a local estimate — so a run can never silently
mix the two.

---

## Latency Analysis

**Median, p95, failure latency: NOT MEASURED.**

The harness records min / median / p95 / max per model, plus retry rate and
failure rate, and defaults to 3 repetitions per scenario on the full suite so
percentiles are not drawn from a single request. Time-to-first-token is
`null` by design on the non-streaming path and is only obtainable once F6 is
fixed and the streaming adapter reports usage.

---

## Model Recommendations

**None can be made.** Every routing recommendation Phase 16 was meant to
produce depends on a measurement that does not exist:

```
Simple questions:            NOT MEASURED — no basis for a recommendation
General academic assistant:  NOT MEASURED
Complex research reasoning:  NOT MEASURED
RAG-heavy citation tasks:    NOT MEASURED
High-volume low-cost tasks:  NOT MEASURED
```

The current production routing — Gemini for `simple`/`standard`, OpenAI for
`advanced`/`reviewer` — is a reasonable *prior*, but it is a design assumption,
not a finding, and this report does not endorse it as one. It was left
unchanged: Step 16 explicitly says routing should not be altered without
evidence, and there is none.

---

## Prompt Recommendations

No prompt change is recommended, because no prompt has been measured.

One candidate is **built and ready to test**, not applied
(`runners/variants.ts`). The A/B changes exactly one thing at a time across five
designated scenarios:

- **Variant A** — production as shipped: `buildSystemInstruction()` verbatim,
  excerpts numbered `[1]` the way `context-manager.ts` renders them.
- **Variant B** — same instruction plus a short citation contract (cite only the
  bracketed key shown on each excerpt; never invent one; if excerpts disagree,
  report both; if they do not answer the question, say so), **with excerpts
  labelled by citation key**.

This is designed to separate two explanations that look identical from the
outside: *the model cannot cite correctly* versus *the pipeline never gave it
anything citable* (F2). Until it runs, rewriting prompts would be guessing, and
would risk "fixing" a prompt to work around a schema defect.

The harness reports the citation-correctness delta between arms and states
explicitly whether it justifies a production change.

---

## Architecture Recommendations

**Keep unchanged.** These are sound and the benchmark exercises them as-is:

- The tier-based, rule-driven classifier — deterministic, and it never spends a
  model call to decide which model to call.
- The dataset hard block (`requiresDataset`): a results/analysis request with no
  dataset never reaches a model, so there is nothing for it to hallucinate
  around. This is the right shape — a code-level guard, not a prompt promise.
- The always-on research integrity instructions.
- Structured output via native schema modes with Zod validation on the way back,
  rather than regex-scraping prose.
- Model ids as configuration, read in exactly one place.
- Secrets: one read site, server-side only, nothing `NEXT_PUBLIC_`, no key in
  any API response. Verified and now pinned by tests.

**Improve, in priority order:**

1. **F2** — join `document_chunks` to `research_citations` and render the
   citation key on retrieved excerpts. Highest leverage in the phase.
2. **F1** — forward `AbortSignal` to both SDKs so the timeout is real.
3. **F3** — run citation verification on `/api/ai/chat` and `/api/ai/generate`.
4. **F6** — capture usage metadata on both streaming paths.
5. **F7** — replace `RATE_TABLE` with verified rates and a `verified_on` date,
   and bill reasoning tokens (now captured) in `calculateCost()`.
6. **F10** — tolerate a markdown code fence before `JSON.parse`.
7. **F11** — restrict `extractCitationKeys` to key-shaped tokens.

**Remove:** the seven dead feature flags and `AI_DEFAULT_PROVIDER` from
`.env.example`, plus `GEMINI_ADVANCED_MODEL` / `OPENAI_STANDARD_MODEL`, or wire
them up. Configuration that silently does nothing is worse than absent
configuration during an incident.

**Add later:** grounding/file-search tool wiring if `needsWeb` is to mean
anything (F4); a reranking step; a claim-level entailment check to complement
numeric provenance.

---

## Production Recommendation

## `NOT READY`

Two independent reasons, either sufficient:

1. **The core question is unanswered.** Zero live model calls were made. No
   claim about accuracy, grounding, citation quality, hallucination rate, Khmer
   quality, latency or cost is supported by evidence. "The architecture is
   implemented" is exactly the assumption Phase 16 existed to replace, and
   without credentials it remains an assumption.
2. **Four measured defects affect production today**, independent of model
   quality: the timeout does not time out (F1); retrieval and citation
   verification are structurally disconnected (F2); the highest-traffic AI route
   performs no citation verification at all (F3); and most usage/cost data in
   the admin dashboard is estimated rather than measured (F6).

This is not a finding that the AI performs badly. It is a finding that its
performance is **unknown**, in a system where the cost of a fabricated citation
lands on a student's thesis. The harness now exists to close that gap in a
single command.

### How to finish Phase 16

```bash
# 1. Supply credentials (server-side only, never committed)
echo 'GEMINI_API_KEY=...' >> .env.local
echo 'OPENAI_API_KEY=...' >> .env.local

# 2. Confirm the keys work and see what models they actually serve
npm run ai:models

# 3. Smoke test first — 3 scenarios, ~6 calls, cents (Step 28)
npm run ai:benchmark:smoke

# 4. Optional but recommended: verified pricing, or cost stays unreported
cp reports/ai-benchmark/pricing.example.json reports/ai-benchmark/pricing.json
#   ...fill in rates verified against each provider's pricing page today...

# 5. Full comparison run: both providers, 3 repetitions, blind LLM judge
AI_BENCH_RATE_FILE=reports/ai-benchmark/pricing.json \
AI_BENCH_MAX_COST_USD=10 \
npm run ai:benchmark:compare
```

Results land in `reports/ai-benchmark/latest.json` and `latest.md`. Then update
the Results, RAG, Khmer, Token/Cost, Latency and Model Recommendations sections
of this report with measured numbers, and re-derive the status.

**Budget rails** are on by default and are hard stops, not advice:
`AI_BENCH_MAX_REQUESTS` (600 full / 12 smoke), `AI_BENCH_MAX_SCENARIOS`,
`AI_BENCH_MAX_COST_USD`, a 90 s per-request timeout enforced by the harness
itself, one retry, bounded concurrency, and graceful `SIGINT` cancellation that
still writes a report.

---

## Reproducibility

| Artifact | Path |
| --- | --- |
| Architecture audit | `AI_ARCHITECTURE_INVENTORY.md` |
| Harness | `tests/ai-benchmark/` |
| Machine-readable result | `reports/ai-benchmark/latest.json` |
| Human-readable result | `reports/ai-benchmark/latest.md` |
| Provider preflight | `reports/ai-benchmark/providers.json` |
| Harness validation (MOCKED) | `reports/ai-benchmark/harness-validation/` |
| Pricing template | `reports/ai-benchmark/pricing.example.json` |
| Harness tests | `tests/ai-benchmark/__tests__/` — 109 tests |

Raw per-execution dumps are written to `reports/ai-benchmark/**/raw/` and
git-ignored: each full run produces megabytes of response text, and
reproducibility comes from the committed harness plus `latest.json`, not from
the dump. Provider error strings pass through `redact()` before reaching any
report, so nothing key-shaped can be committed; a test enforces that no fixture
contains a credential.

### Commands

| Command | What it does |
| --- | --- |
| `npm test` | Full suite, 443 tests, no network |
| `npm run ai:models` | Live provider preflight + model discovery |
| `npm run ai:benchmark:smoke` | 3 scenarios — wiring and cost validation |
| `npm run ai:benchmark:full` | All 56 scenarios, 3 repetitions |
| `npm run ai:benchmark:gemini` / `:openai` | One provider |
| `npm run ai:benchmark:compare` | Both providers + blind judge |
| `npm run ai:benchmark:dry` | Offline stub run — validates the harness, **MOCKED** |
