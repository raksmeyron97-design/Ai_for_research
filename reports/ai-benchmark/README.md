# AI benchmark artifacts — what each of these files is

Five different things in this repository can produce a table of model numbers,
and four of them are not a benchmark result. Phase 21 §10 exists because those
five were distinguishable only by knowing which command had last been run.

## The five, in increasing order of what they prove

| # | Thing | Provider calls | What it establishes | Where it lands |
| --- | --- | --- | --- | --- |
| 1 | **Credential / configuration probe** | 1 per provider (`models.list`) | A key is accepted and which model ids the key can see. **Nothing about quality, latency or cost.** | `providers.json` |
| 2 | **Live provider smoke test** | ~12 | The production path reaches a real provider and a real response comes back. A wiring check. | `latest.json` (suite `smoke`) |
| 3 | **Live benchmark** | ~765 | Scored behaviour of real models across the whole scenario suite. The only thing that may be quoted as a result. | `latest.json` (suite `full`) |
| 4 | **Dry benchmark** | **0** | The harness runs end to end and its reporters produce a well-formed report. Every number is from the deterministic stub. | `dry/latest.*` |
| 5 | **Mock / harness validation** | 0 | The evaluators score known-good and known-bad outputs correctly — the harness grading itself. | `harness-validation/` |

The distinction that matters most, and the one that has actually misled
readers of this repository:

> **Provider model metadata does not imply a benchmark ran.**
> `providers.json` listing 52 Gemini models and 118 OpenAI models means a key
> was accepted. It says nothing about whether a single scenario completed.

## Status of the committed record, as of Phase 22

**Two live smoke runs have completed. AI quality is still NOT MEASURED.**
Both halves matter, and the second is the one people get wrong.

`latest.json` is `run_2026-09-05T16-18-26-795Z_6a74f04f`: suite `smoke`,
`mode: "live"`, 20 provider calls, `completeness: complete`, well inside its
ceilings. Execution modes `LIVE: 7`, `DEGRADED: 1`, `UNAVAILABLE: 4`. That is
category 2 in the table above — a wiring check over three scenarios — and it
is not category 3. Three scenarios at one repetition describe that run, not a
model.

What the two runs established:

* **Gemini is reachable and billable.** Seven scored executions per run, cost
  priced from `src/lib/ai/pricing.ts`. $0.034 and $0.036 respectively.
* **OpenAI is blocked, and the artifact names the blocker:** `429 You have no
  credits remaining.` Every OpenAI execution is UNAVAILABLE. **No OpenAI
  quality figure exists, and none may be inferred.** There is therefore no
  provider comparison, and nothing in this repository supports one.
* **Cross-provider fallback works under a real outage.** The single `DEGRADED`
  execution in each run is the routed group failing over from OpenAI to Gemini
  and still returning an answer — production recovery observed rather than
  asserted.
* **The production path finds bugs a stub cannot.** See below.

### Why there are two runs, and why the first one's numbers are wrong

The first live run in this project's history
(`archive/run_2026-09-05T15-31-53-902Z_db0df567.json`) found a production bug
in the thing it was measuring.

`research-integrity-guard.ts` rule 3 requires the model to label claims
`[VERIFIED]`, `[INFERENCE]`, `[SOURCE_REQUIRED]` and so on. Gemini complied.
`extractCitationKeys` judges a bracket token by its shape, so it read those
labels as citation keys, and `verifyCitationsInText` told the researcher — at
`high` severity — that `"VERIFIED"` was a citation matching no saved source.
Five of eight scored executions carried it, on answers that were otherwise
correct: right prevalence, right confidence interval, right source.

It also corrupted that run's own metrics: `fabricated_citation_rate` 1.0,
`citation_precision` 0.5, and a recommendation claiming variant B "changed
citation correctness by -50.0 points".

The fix is in `src/lib/ai/integrity-guard.ts`. The second run, on the fixed
code, is the same three scenarios against the same models:

| | first run | second run |
| --- | --- | --- |
| `fabricated_citation_rate` | 1.0 | **0** |
| `citation_precision` | 0.5 | **1.0** |
| production warnings on scored executions | 8 | **0** |
| overall score range | 50.0 – 66.9 | **74.9 – 100** |

That difference is the bug being removed, not a model improving. Neither
column is a quality measurement.

The first run is preserved unrescored (§61): it is the evidence that the bug
reached production.

### What is still open in the current run

* `gemini-3.1-pro-preview` returned JSON that does not satisfy the
  `quality_check` schema — `PARSING_FAILURE`, overall 11.1. In production the
  caller discards such a response and shows placeholder scores. This is the
  advanced/reviewer-tier Gemini model.
* One `rag-c3` variant answered a question the evidence does not support
  without flagging that it does not — `HALLUCINATION`, false confidence. The
  other variant abstained correctly.
* One `GROUNDING_FAILURE` on `struct-quality-check` is a **false positive**
  and was fixed after this run was written: the evaluator only accepted
  numbers from the retrieved corpus, and this scenario's material under review
  is in the prompt, so the model quoting the researcher's own "100 women" back
  was scored as an unsupported claim. The fix is in
  `tests/ai-benchmark/evaluators/grounding.ts`; this artifact predates it, so
  its `structured_output` score for `gemini-3.6-flash` is understated.

### Precisely

```
LIVE SMOKE      = COMPLETED (2026-09-05), Gemini only, twice
LIVE BENCHMARK  = NOT MEASURED
AI QUALITY      = NOT MEASURED
PROVIDER COMPARISON = NOT POSSIBLE (OpenAI has no credits)
OPENAI          = BLOCKED (429, no credits remaining)
```

### The records these replaced

`archive/` holds every live report a later live run displaced:

* `run_2026-09-01T11-19-35-444Z_a2266530.json` — the Phase 16B attempt,
  `{"UNAVAILABLE": 12}`: a credential probe that succeeded and twelve
  scenarios that produced no result, on provider billing.
* `run_2026-09-05T15-31-53-902Z_db0df567.json` — the first scored live run,
  described above.

They are archived rather than overwritten because until Phase 22 a live run
destroyed its predecessor: `writeReport` wrote `latest.json` in place and its
per-run copy went to `raw/`, which is gitignored. `archive/` is committed, and
`archiveExistingLiveReport` fills it before any live write.

## The dry/live split

Before Phase 21, `npm run ai:benchmark:dry` wrote `latest.json` and
`latest.md` into *this* directory, silently overwriting the live record with a
stub report. Phase 20 hit it and had to discard the overwrite by hand.

Now:

```
reports/ai-benchmark/
├── README.md               ← this file
├── latest.json / latest.md ← LIVE only. Committed. A dry run cannot write here.
├── providers.json          ← credential/configuration probe (category 1)
├── pricing.example.json    ← rate-file template
├── harness-validation/     ← category 5, MOCKED, committed
├── dry/                    ← category 4, MOCKED, gitignored
└── raw/                    ← per-execution dumps, gitignored, regenerated
```

The redirect is applied in `resolveOutDir()` and covers an explicitly set
`AI_BENCH_OUT_DIR` too — an operator who redirects the harness has the same
live record to lose.

Two gates hold it in place:

- `npm test` — `tests/ai-benchmark/__tests__/artifact-isolation.test.ts`
  checks the decision, in the fast suite where a regression is seen.
- `npm run ai:benchmark:verify-isolation` — hashes every live artifact, runs
  the real dry gate, hashes them again, and additionally asserts 0 provider
  calls, `mode: "dry"`, and that every execution mode is `MOCKED`.

## Reading any report in here

- **`mode`** (`live` | `dry`) — added in Phase 21. Absent on artifacts written
  before it; those predate the split and are live-directory files.
  `mode: "live"` asserts the harness was pointed at real providers. It does
  **not** assert that any call succeeded — `execution_modes` says that.
- **`execution_modes`** — the honest summary. `MOCKED` = stub.
  `UNAVAILABLE` = the call did not happen. Anything else = a real exchange.
- **`status`** — `NOT READY` is the harness's judgement about the *run*, not
  about the models.
- **`caveats`** — read before quoting a number. A single-repetition smoke run
  describes that run, not the model.
