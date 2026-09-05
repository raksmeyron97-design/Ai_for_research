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

**A live run has completed. It is a smoke run, and its quality scores are not
usable as a measurement.** Both halves of that matter.

`latest.json` is `run_2026-09-05T15-31-53-902Z_db0df567`: suite `smoke`,
`mode: "live"`, 20 provider calls, `completeness: complete`. Its execution
modes are `LIVE: 7`, `DEGRADED: 1`, `UNAVAILABLE: 4`. That is the first time
in this project's history that any scenario produced a scored live result, and
it is category 2 in the table above — a wiring check — not category 3.

What it establishes:

* **Gemini is reachable and billable.** Seven scored executions, cost priced
  from `src/lib/ai/pricing.ts` at $0.034 for the run.
* **OpenAI is still blocked, and the blocker is named in the artifact:**
  `429 You have no credits remaining.` Every OpenAI execution is UNAVAILABLE.
  No OpenAI quality number exists, and none may be inferred.
* **Cross-provider fallback works under a real outage.** The one `DEGRADED`
  execution is the routed group failing over from OpenAI to Gemini and
  returning an answer. That is production recovery behaviour, observed rather
  than asserted.

Why the scores may not be quoted: the run's own citation metrics are
corrupted by a bug it found. `research-integrity-guard.ts` rule 3 requires the
model to label claims `[VERIFIED]`, `[INFERENCE]` and so on; the citation
verifier read those labels as citation keys, and reported them to the
researcher as `high` severity fabricated citations. Five of the eight scored
executions carry it. It drove `fabricated_citation_rate` to 1.0, halved
`citation_precision`, and produced the A/B line claiming variant B "changed
citation correctness by -50.0 points". The underlying answers were correct —
right prevalence, right confidence interval, right source.

The bug is fixed in `src/lib/ai/integrity-guard.ts` as of Phase 22. **This
artifact is preserved as it was written (§61) and is not rescored**, because
it is the evidence that the bug existed in production. A re-run after the fix
would be a different run and gets a different file.

So, precisely:

```
LIVE SMOKE      = COMPLETED (2026-09-05), Gemini only
LIVE BENCHMARK  = NOT MEASURED
AI QUALITY      = NOT MEASURED
OPENAI          = BLOCKED (no credits)
```

### The record this replaced

`archive/run_2026-09-01T11-19-35-444Z_a2266530.json` is the Phase 16B attempt:
`"execution_modes": {"UNAVAILABLE": 12}` — a credential probe that succeeded
and twelve scenarios that all failed to produce a result, on provider billing.

It is archived rather than overwritten because until Phase 22 a live run
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
