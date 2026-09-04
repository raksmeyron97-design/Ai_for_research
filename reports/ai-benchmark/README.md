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

## Status of the committed record, as of Phase 21

**No live benchmark has ever completed. `LIVE BENCHMARK = DEFERRED`.**

`latest.json` is the closest thing that exists, and read carefully it is
category 1 plus a *failed* category 2:

```json
"suite": "smoke",
"providers": { "gemini": { "status": "LIVE", ... }, "openai": { "status": "LIVE", ... } },
"execution_modes": { "UNAVAILABLE": 12 },
"status": "NOT READY"
```

`status: "LIVE"` on a provider means **the credential probe succeeded** — the
key was accepted and models were enumerated. `execution_modes` is the line
that says what happened next: all **12 of 12** scenario calls came back
`UNAVAILABLE`, i.e. no scenario produced a scored result. Provider billing
credit is the blocker, as it has been since Phase 16B.

This file is preserved exactly as it was written (§61). It is real evidence of
a real attempt, and it is labelled here for what it is rather than rewritten
to look tidier or deleted to look cleaner.

Every other run recorded under `raw/` is `"MOCKED": 765` — a dry run.

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
