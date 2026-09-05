# Phase 22 — Production Verification, CI Reproducibility & AI Quality Evidence

Phase 21 ended with two things it could not claim. The CI workflow it added
had never executed, and no live AI benchmark had ever completed, so the
project's central claim — that the AI path is good enough for research work —
rested on a dry run against a stub.

Phase 22 closed the first gap and made real progress on the second. It also
found four defects, three of them in controls that were documented as working,
and one of them user-facing in production. Every one was found by executing
something rather than by reading it.

The honest summary is at the bottom (§10). It is **PASS WITH WARNINGS**, and
AI quality remains **NOT MEASURED**.

---

## 1. Baseline (22A)

Branched from the exact verified Phase 21 tip, working tree clean.

| | |
| --- | --- |
| Branch | `feat/phase-22-production-verification-ai-quality` |
| Start commit | `51a02ad` (Phase 21 tip, verified `HEAD == 51a02ad`) |
| Lineage | `f532c17` (Phase 20) → `51a02ad` (Phase 21) → this branch |
| End commit | `c9d287a` |

Every Phase 21 gate was re-executed before any change was made, and every one
reproduced: 1,595 tests / 143 files, lint, typecheck, build, `npm audit` 0.

---

## 2. CI, executed (22B)

**`.github/workflows/ci.yml` had never run.** `gh run list` was empty, and the
Phase 19, 20 and 21 branches were never pushed — `origin` held only `main`,
`phase-17b` and `phase-18`. Phase 21 recorded this honestly as `NOT RUN`.

It now runs. The branch was pushed and
[PR #1](https://github.com/raksmeyron97-design/Ai_for_research/pull/1) opened,
which triggered the `pull_request` workflow on GitHub's own runners.

| | |
| --- | --- |
| Run | `33974855541` |
| Commit | `526e5da` |
| Event | `pull_request` |
| Runner | GitHub-hosted `ubuntu-latest` |
| Executed | 2026-09-05T15:27:26Z → 15:29:35Z (2m09s) |
| Result | **success — all three jobs, every step** |

| Job | Steps | Result |
| --- | --- | --- |
| `checks` | npm ci, lint, typecheck, `npm test`, build with no AI credentials | success |
| `benchmark-artifacts` | `ai:benchmark:verify-isolation`, working tree unchanged | success |
| `database` | `supabase start` from empty, all isolation suites, `db:profile` | success |

It has run three times on this branch, green every time:

| Run | Commit | Result |
| --- | --- | --- |
| `33974855541` | `526e5da` (branch as opened) | success — all three jobs |
| `33977742902` | `c9d287a` (after every code fix) | success — all three jobs |
| `33978092814` | `5799905` (all code and evidence) | success — all three jobs |

A note on the last row, because it is the honest version of a small
circularity: recording a CI result in a document changes the commit, so the
run named here is the one on the commit *before* this sentence was written.
The commit that adds this sentence changes markdown only — no source, no
test, no workflow — and its own run is visible on the pull request.

### What CI execution actually settled

Two assumptions were untested until it ran, and both held:

* **The build does not need `.env.local`.** CI has no env file and no Supabase
  variables. `next build` succeeds anyway, which is §44's "AI is optional"
  asserted by a machine that has never seen this project.
* **`scripts/db-isolation.sh` finds its container on a foreign host.** It reads
  `project_id` from `supabase/config.toml` rather than assuming a directory
  name, and the runner's checkout is `Ai_for_research` while the container is
  `supabase_db_AI_for_research`. The indirection Phase 21 added for local
  clones turned out to be what makes it work in CI.

### Limitations, unchanged and deliberate

* **The browser suite is not in CI.** It needs a built app, a Supabase stack
  and a real Chrome. It stays a local gate.
* **The live AI benchmark never runs in CI, by design.** There are no provider
  keys there and there must not be.

---

## 3. Clean-environment bootstrap (22C)

Executed from a genuinely empty state, not from a reset of a working one. The
Docker volumes (`supabase_db_AI_for_research`, `..._storage_...`,
`..._edge_runtime_...`) were destroyed and their absence confirmed before
`supabase start` was run.

| Measure | Expected | Observed |
| --- | --- | --- |
| Migrations applied from empty | 26 | **26** |
| Tables in `public` | 35 | **35** |
| Tables with RLS enabled | 35 | **35** |
| Tables *without* RLS | 0 | **0** (empty result) |
| Functions in `public` | 124 | **124** |

No manual SQL, no developer-local rows, no undocumented step.

| Isolation suite | Result |
| --- | --- |
| Phase 17 | **PASS** (executed) |
| Phase 17B | **PASS** (executed) |
| Phase 18 | **PASS** (executed) |
| Phase 19 | **PASS** (executed) |
| Phase 20 | **PASS** (executed) |
| Phase 21 | **PASS** (executed) |

`npm run db:profile` — all budgets met against the 150-source fixture, every
query an order of magnitude inside the 200 ms ceiling (source search first page
6.5 ms, text query 11.2 ms, framework load 4.3 ms, questionnaire load 2.4 ms,
integrity review fetch 8.2 ms).

---

## 4. Benchmark artifact integrity (22D)

### The dry/live split still holds

`npm run ai:benchmark:verify-isolation` hashes every live artifact, runs the
real dry gate, and hashes again. All seven live artifacts byte-identical;
0 provider calls; `mode=dry`; every execution mode `MOCKED`. Also green on the
CI runner.

### A live run could destroy the live run before it — fixed

Phase 21 stopped a *dry* run damaging the live record. It left the other half
of the same loss open, and the audit found it before any live execution.

`writeReport` writes `latest.json` in place, and the per-run copy beside it
goes to `raw/`, which `.gitignore` excludes. So the only committed trace of any
live run was `latest.json`, and the next live run overwrote it with nothing
kept.

The file this would have destroyed was not hypothetical:
`reports/ai-benchmark/latest.json` held the Phase 16B record — a credential
probe that succeeded and twelve scenarios that all came back UNAVAILABLE. The
README described it, a test asserted against it, and it cannot be regenerated
because it describes a provider state that no longer obtains.

`archiveExistingLiveReport` now preserves the report a live run replaces, keyed
by the run id inside the file it holds, so re-archiving is idempotent and the
name says which run it is. A report too malformed to parse is archived too.
Dry runs are excluded: `dry/` is gitignored and regenerable.

**Verified in anger, twice.** Both live runs in this phase displaced a
predecessor, and both predecessors are in `archive/` — including the Phase 16B
record the fix was written for, which the very next command would otherwise
have destroyed.

Regression tests: archive-on-live, no-archive-on-dry, unparseable preserved,
idempotent re-archive, plus a repository-level check that a committed live
report implies a committed archive.

---

## 5. Live benchmark readiness (22E)

The benchmark was audited as financial infrastructure before any paid call.
Two of its controls did not hold. Both were documented as working.

### The cost ceiling was never enforced

`RunBudget.costUsed` was incremented by nothing in the entire run path. The
only writer in the repository was a unit test assigning to the field, which is
why three green tests sat on top of it for five phases.

`AI_BENCH_MAX_COST_USD` is documented in `docs/ROADMAP.md` as the way to cap
the live comparison at \$15, and recorded as `PASS` in the Phase 16A control
table. **It could not have stopped a run at any price.** The repository's own
authorised live-benchmark procedure depended on it.

Spend is now charged from each execution's measured, verified cost.

### The request ceiling could be overrun

`exhausted` was consulted only between scenarios. But a scenario that has
already started issues its retry, its cross-provider fallback and its reviewer
pass from *inside* the orchestrator, below anything the harness was watching,
so the "hard stop" could be overrun by roughly concurrency × calls-per-scenario.

The ceiling is now checked at the adapter boundary, before the network, so a
refusal costs nothing and a refused call is recorded as refused rather than
counted as a provider call it never made.

**Proven end to end at zero cost:** a dry run capped at 5 executed exactly 5
and skipped 760, reporting
`completeness: {"status":"partial","reason":"request ceiling reached (5)"}`.

### What the ceilings still cannot see

A cost ceiling can only count spend it can price. An unpriced model contributes
0, because the alternative is inventing a rate and printing a dollar figure the
report is forbidden to print. `unpricedCalls` records how much of a run was
invisible to it.

This is not theoretical: **`gemini-3.1-pro-preview` — the default advanced
*and* reviewer Gemini model — has no verified rate** in `src/lib/ai/pricing.ts`.
In a Gemini-pinned group, advanced-tier scenarios are outside the cost ceiling.
Such a run is bounded by `maxRequests` alone. The report states this as a
caveat rather than omitting it.

### The other seven checks

| Check | Result |
| --- | --- |
| Scenario subset | 3 scenarios (`rag-c1-prevalence-single`, `rag-c3-cost-effectiveness`, `struct-quality-check`) |
| Expected call count | 12 planned runs; hard cap 24 |
| Provider routing | `gemini`, `openai`, `routed` groups via real feature flags and `resolveProvider` |
| Every call counted | Yes — counted at the adapter boundary, so retries, fallbacks and reviewer passes are included |
| Artifact destination | live directory, predecessor archived first |
| Failure handling | UNAVAILABLE recorded honestly; never synthesised |
| Redaction | `redact()` strips key-shaped strings, `key=`, and authorization headers from every error before it reaches a report |
| Authorisation gate | The repository's own documented procedure — smoke first — plus explicit operator approval |

---

## 6. The live benchmark (22F)

Executed twice, both times through `AIOrchestrator` on the production path:
real classification, real routing, real retry and fallback, real usage
accounting, real citation verification. No adapter was benchmarked directly.

| | Run 1 | Run 2 |
| --- | --- | --- |
| Run id | `run_2026-09-05T15-31-53-902Z_db0df567` | `run_2026-09-05T16-18-26-795Z_6a74f04f` |
| Suite | smoke | smoke |
| Provider calls | 20 | 20 |
| Completeness | complete | complete |
| Execution modes | LIVE 7, DEGRADED 1, UNAVAILABLE 4 | LIVE 7, DEGRADED 1, UNAVAILABLE 4 |
| Priced cost | \$0.0340 | \$0.0359 |

Total spend for the phase: **\$0.070**. Both runs stayed inside a 24-call and
\$1.00 ceiling, and neither was truncated.

Three things this establishes, and one it does not.

* **Gemini is reachable and billable.** The Phase 16B blocker is resolved for
  Gemini.
* **OpenAI is still blocked, and the artifact names the blocker:**
  `429 You have no credits remaining.` Every OpenAI execution is UNAVAILABLE.
* **Cross-provider fallback works under a real outage.** The single `DEGRADED`
  execution in each run is the routed group failing over from OpenAI to Gemini
  and still returning an answer. Production recovery observed, not asserted —
  and observable only because OpenAI genuinely was down.
* **It does not establish AI quality.** Three scenarios at one repetition is a
  wiring check.

---

## 7. AI quality (22G)

### The finding

The first live run found a production bug in the thing it was measuring, and
nothing else could have found it.

`research-integrity-guard.ts` rule 3 tells every model that "every non-trivial
claim you generate must be labeled with one of: VERIFIED, SOURCE_REQUIRED,
USER_PROVIDED, INFERENCE, or UNVERIFIED". Gemini complied, writing them in
brackets beside its citations. `extractCitationKeys` judges a bracket token by
its shape, and `VERIFIED` starts with a letter and is longer than three
characters, so it is a citation key as far as the grammar is concerned.
`verifyCitationsInText` then found no saved source with that key and returned,
at `high` severity:

> Citation "VERIFIED" was referenced but does not match any saved source for
> this project.

Which the API routes surface to the researcher. **The application asked for the
label and then reported it as a fabricated citation.**

Five of eight scored executions carried it. The answers underneath were
correct: right prevalence (21.4%), right confidence interval (18.2–24.9%),
right sample description, right source.

The dry benchmark could never have caught it. The stub does not follow the
system instruction, because it is not a model.

The labels now join the class `verifyCitationsInText` already had for `[1]` —
looked up, so a project that genuinely stores a source keyed `UNVERIFIED` still
has its citation honoured, but never warned about when they resolve to nothing.
An invented key is still caught, and there is a test that says so. The
vocabulary has one definition, exported beside the prompt text that asks for
it, with a drift test — because the symptom of drift is a researcher being told
a correct answer cites a fabricated source.

### What the fix changed, measured

Same three scenarios, same models, same ceilings:

| | before fix | after fix |
| --- | --- | --- |
| `fabricated_citation_rate` | 1.0 | **0** |
| `citation_precision` | 0.5 | **1.0** |
| `citation_recall` | 1.0 | 1.0 |
| production warnings on scored executions | 8 | **0** |
| overall score range | 50.0 – 66.9 | **74.9 – 100** |

**That difference is a bug being removed, not a model improving.** Neither
column is a measurement of AI quality, and the first run's numbers are
preserved unrescored because they are the evidence that the bug reached
production.

### Results from the current run

Gemini only. Every figure below is from one repetition of three scenarios and
describes that run.

| Group / model / variant | Overall | Citation precision | Recall | Fabricated |
| --- | ---: | ---: | ---: | ---: |
| `gemini` / gemini-3.6-flash / B | 100.0 | 1.0 | 1.0 | 0 |
| `routed` / gemini-3.6-flash / B | 99.7 | 1.0 | 1.0 | 0 |
| `gemini` / gemini-3.6-flash / A | 85.7 | 1.0 | 1.0 | 0 |
| `routed` / gemini-3.6-flash / A | 74.9 | 1.0 | 1.0 | 0 |
| `routed` / gemini-3.1-pro-preview / A | 11.1 | n/a | n/a | 0 |
| `openai` / gpt-5.4-mini / A, B | **null** | — | — | — |
| `openai` / gpt-5.6 / A | **null** | — | — | — |

Citation correctness is scored as *correct / mismatched / fabricated*, never as
"a citation was present".

Remaining failures, and what each one is:

* **`gemini-3.1-pro-preview`, `PARSING_FAILURE` (high).** Returned JSON that
  does not satisfy the `quality_check` schema; overall 11.1. In production the
  caller discards such a response and shows placeholder scores. This is the
  advanced *and* reviewer tier model, so it is worth knowing — from one
  observation.
* **`rag-c3-cost-effectiveness`, `HALLUCINATION` (critical), one variant.**
  Answered a question the evidence does not support without flagging that it
  does not. The other variant abstained correctly, which is the same model
  doing the right thing on the same question — a variance signal, not a verdict.
* **`struct-quality-check`, `GROUNDING_FAILURE` (high) — a false positive**,
  fixed after the run was written. The evaluator accepted numbers only from the
  retrieved corpus, but this scenario's material under review is in the prompt,
  so the model quoting the researcher's own "convenience sample of 100 women"
  back at them scored as an unsupported claim. The committed artifact predates
  the fix, so its `structured_output` score is understated. Recorded here
  rather than corrected in the file: rescoring a live artifact after the fact
  is what §61 forbids.
* **OpenAI × 3, `RATE_LIMIT` (medium).** `429 You have no credits remaining.`

### Confidence

| Claim | Status |
| --- | --- |
| Gemini is reachable, billable, and returns grounded, correctly-cited answers on this fixture | **observed** (7 executions, 2 runs) |
| The integrity-label bug reached production and is now fixed | **verified** (reproduced live, fixed, re-run clean, unit-tested) |
| Cross-provider fallback recovers from a real provider outage | **observed** (1 execution per run) |
| gemini-3.1-pro-preview is unreliable for structured output | **suggestive** (1 observation) |
| gemini-3.6-flash's overall quality | **insufficient evidence** (3 scenarios, 1 repetition) |
| Any OpenAI quality figure | **not measured** — no scored execution exists |
| Gemini vs OpenAI comparison | **not possible** — and nothing in this repository supports one |
| Khmer handling | **not measured** — no Khmer scenario is in the smoke subset |
| Full RAG-class coverage | **not measured** — smoke covers classes 1 and 3 only |

### The architecture is unchanged

A benchmark result cannot override a deterministic control. The path remains
AI → schema validation → integrity guard → researcher. Nothing in this phase
allowed a score to relax a check; the one change to the integrity guard makes
it *more* accurate, not more permissive, and the test that a fabricated key is
still caught exists precisely to hold that line.

---

## 8. Production smoke (22H)

`npm run test:browser` — **71 passed**, real Chrome, six widths
(320/375/414/768/1024/1280), unchanged from Phase 21. The Phase 21
`workers: 2` setting was retained; it was measured, not guessed.

The AI-off path is covered by `npm test`, which runs with no provider
credentials, and by the CI `checks` job building the app with none present.

### The browser gate tested whatever answered on port 3100 — fixed

Port 3100 was hard-coded in three places — the server command, the readiness
URL and the default baseURL — and `reuseExistingServer` reuses whatever is
listening without asking whose it is.

Found by running the suite on a machine where an unrelated project's
`next dev -p 3100` was already up. Its `/login` answered 404, so the gate sat
in the webServer wait for the full 300 s and then failed with "Timed out
waiting 300000ms from config.webServer" — a message naming neither the port nor
the process holding it.

The timeout is the harmless version. **Had that server answered 200, all 71
tests would have run against another application and reported the result as
this one's.**

Now: one source of truth for the port, overridable with `PLAYWRIGHT_PORT`, and
a check that refuses to proceed unless the server actually serves this app. The
marker is the document title from `src/app/layout.tsx`, which Next renders into
the served HTML — not the sign-in form, because `/login` is a client component
whose markup is not in the response at all. An identity check looking for the
email field rejects this application, which is what the first attempt did and
how that was learned. A test in the fast suite fails if the marker drifts from
the layout.

---

## 9. Security (22J)

| Check | Result |
| --- | --- |
| `npm audit` | **0 vulnerabilities** |
| Secrets in the repository | `.env.local` untracked; only `.env.example` committed; the new commits scanned for key-shaped strings, none found |
| Provider key exposure in reports | `redact()` strips key-shaped strings, `key=` parameters and authorization headers from every provider error before it reaches an artifact or a log |
| RLS | enabled on all 35 tables from a clean bootstrap; six isolation suites executed against real Postgres |
| Prompt injection | `orchestrator-injection-guard` and `prompt-injection-guard` suites green; rule 6 of the system instruction treats researcher-supplied content as data |
| Citation fabrication | cannot be bypassed — an invented key is still warned about; only the labels the app itself requires stopped being reported |
| Unbounded provider calls | now genuinely bounded; see §5 |
| Observability | the Phase 21 event vocabulary is unchanged and still cannot carry research content |

Nothing in this phase widened a boundary. The one production behaviour change
removes a false warning; it does not remove a true one.

---

## 10. Release gate

| Gate | Result |
| --- | --- |
| `npm test` | **1,615 passed / 143 files** (was 1,595) |
| `npm run lint` | pass |
| `npm run typecheck` | pass |
| `npm run build` | pass |
| `npm run ai:benchmark:dry` | pass |
| `npm run ai:benchmark:verify-isolation` | pass — live artifacts byte-identical, 0 provider calls |
| `npm run test:browser` | **71 passed** (real Chrome, six widths) |
| Clean bootstrap from destroyed volumes | **26/26 migrations, 35 tables, RLS 35, 124 functions** |
| Phase 17 / 17B / 18 / 19 / 20 / 21 isolation | **PASS** (all executed) |
| `npm run db:profile` | all budgets met |
| `npm audit` | **0 vulnerabilities** |
| **CI workflow** | **PASS — executed on a GitHub-hosted runner**, three runs, all three jobs each |
| Live Gemini calls | 40 across two smoke runs, \$0.070 |
| Live OpenAI calls | 0 scored — `429 no credits remaining` |

### Warnings

* **AI quality is NOT MEASURED.** Two smoke runs are wiring checks. The full
  suite has never run live.
* **OpenAI is BLOCKED** on billing credit, so no provider comparison exists and
  none may be inferred.
* **Khmer handling is NOT MEASURED.** No Khmer scenario is in the smoke subset.
* **`gemini-3.1-pro-preview` is unpriced**, so advanced- and reviewer-tier
  Gemini spend is invisible to the cost ceiling. The request ceiling still
  bounds it.
* **The committed live artifact's `structured_output` score is understated**,
  because it predates the grounding-evaluator fix. Documented, not rescored.
* **One unreproduced test failure.** A single `npm test` run reported
  `1 failed | 1612 passed`. Three subsequent full runs and five targeted runs
  of every changed file were clean, and the failing test was not captured. It
  is recorded here rather than dismissed: an unexplained failure that stopped
  happening is not the same as one that was understood.
* The Phase 21 limitations carry forward unchanged: the browser suite is not in
  CI, performance budgets are local measurements, operational events have one
  sink, result traceability remains `not_computable`.

### Verdict

**PASS WITH WARNINGS.**

CI reproducibility is closed: the workflow executed on a machine that had never
seen this project and every job passed. Clean-environment bootstrap is closed:
26 migrations from destroyed volumes with no manual step. Artifact integrity is
closed in both directions for the first time.

AI quality is not closed, and this document does not pretend otherwise. What
the live runs bought was not a quality number — it was four defects, three in
controls the documentation called working, and one that was telling researchers
their correct, well-cited answers contained fabricated citations.

Not production-ready. Considerably better understood.

---

## 11. Deferred

* the full live benchmark (`ai:benchmark:compare`) — needs OpenAI credit for a
  comparison, and \$1–2 of Gemini credit for a Gemini-only measurement
* Khmer, methodology, questionnaire, language and writing scenarios have never
  run live
* a verified rate for `gemini-3.1-pro-preview`
* running the browser suite in CI
* identifying the single unreproduced test failure
