# Roadmap

| Phase | Scope | Status |
| --- | --- | --- |
| 0-1 | Next.js 15 app, AI orchestration foundation | COMPLETE |
| 2-6 | Supabase backend, RAG, AI Copilot UI, research intelligence, questionnaire builder | COMPLETE |
| 7-9 | Data analysis, discussion/conclusion generators, document export | COMPLETE |
| 10 | Admin analytics dashboard | COMPLETE |
| 15 | Production security, reliability, AI safety hardening | COMPLETE |
| 16 | AI validation harness + architecture audit (11 findings) | COMPLETE |
| 16A | Pre-benchmark hardening: F11, F10, F9, F7, F4/F5, streaming timeout | COMPLETE |
| 16B | Live Gemini vs OpenAI benchmark | **BLOCKED** — OpenAI has no credits |
| 16 (workflow) | Section-aware research workflow, change control, versioning | COMPLETE |
| 17 | Advanced Evidence & Literature Workspace (model + deterministic review) | COMPLETE |
| 17B | Researcher-facing evidence & literature workspace | COMPLETE |
| 18 | Advanced Methodology & Questionnaire Intelligence | COMPLETE |
| 19 | Research Integrity, Citation Verification & Academic Quality | COMPLETE |
| 20 | Research Intelligence Validation, Conceptual Framework & Production Verification | COMPLETE |
| 21 | Production Reproducibility, Workspace Completion & Operational Hardening | COMPLETE |
| 22 | Production Verification, CI Reproducibility & AI Quality Evidence | COMPLETE |

## Live AI benchmark: PARTIAL

**Live smoke: DONE (Phase 22). Full benchmark: NOT MEASURED. Provider
comparison: NOT POSSIBLE.**

Two live smoke runs completed on 2026-09-05, driving the full production path.
They cost $0.070 together and are recorded in
[`docs/PHASE_22_PRODUCTION_VERIFICATION.md`](./PHASE_22_PRODUCTION_VERIFICATION.md)
and `reports/ai-benchmark/README.md`.

* **Gemini** is reachable and billable. Seven scored executions per run.
* **OpenAI** is still blocked: `429 You have no credits remaining.` Every
  OpenAI execution is UNAVAILABLE, so there is no comparison and nothing in
  this repository supports one.

A smoke run is a wiring check over three scenarios at one repetition. **It is
not a measurement of AI quality**, and neither run may be quoted as one.

Projected cost for the full comparison is $1.87-$3.24, or $3.75-$6.47 with the
blind judge — needs OpenAI credit. A Gemini-only full run needs neither and is
the cheaper next step.

To run it: `npm run ai:benchmark:smoke` first (~12 calls, cents), then
`AI_BENCH_MAX_REQUESTS=1800 AI_BENCH_MAX_COST_USD=15 npm run ai:benchmark:compare`.

> **On that cost cap.** Until Phase 22 `AI_BENCH_MAX_COST_USD` did nothing:
> `RunBudget.costUsed` was never incremented by any run code, so the ceiling
> could not stop a run at any price. It is enforced now, and the request
> ceiling is enforced at the adapter boundary rather than between scenarios.
> One limit remains stated rather than fixed: `gemini-3.1-pro-preview` has no
> verified rate, so advanced- and reviewer-tier Gemini spend is invisible to
> the cost ceiling and bounded only by `AI_BENCH_MAX_REQUESTS`.

## Open gaps by phase

**Phase 16 (workflow):** evidence insertion cards, section review panel
(closed in 17), conceptual framework editor, mobile layout (closed in 17),
version history UI (closed in 17), component tests (closed in 17).

**Phase 17:** closed by 17B — evidence cards and the insertion flow, claim
extraction, source comparison, themes, the research gap matrix, and the review
and version-history panes are now mounted in the editor.

**Phase 17B:** closed by 20 — server-side source search/filter across a large
library, and claim offsets no longer decide anything on their own (they propose
a span the claim text must confirm, so a drifted offset is refused rather than
believed). Comparison is still capped at five sources; theme suggestion still
reads bibliographic lines rather than full text.

See `docs/PHASE_17B_EVIDENCE_LITERATURE_WORKSPACE.md` §14 for detail, and
`docs/PHASE_17_EVIDENCE_LITERATURE_WORKSPACE.md` for the underlying model.

**Phase 18:** closed by 20 — the conceptual framework is now a relational model
whose nodes reference canonical constructs, with a researcher-facing workspace,
and the responsive layout has a real-browser pass at 320/375/414/768/1280 that
found two genuine defects. Linguistic item checks are still heuristics,
statistical compatibility is still advisory, and psychometric validity still
cannot be inferred without data.

See `docs/PHASE_18_METHODOLOGY_QUESTIONNAIRE_INTELLIGENCE.md` §15 for detail,
and `docs/PHASE_18_METHODOLOGY_AUDIT.md` for the model decisions.

**Phase 19:** the isolation gate is closed — `phase19_project_isolation.sql`
was executed against real Postgres in Phase 20 and passed unmodified (Docker
Desktop turned out to be present but paused, and the CLI missing from PATH).
Inline manuscript highlighting is closed: a finding now selects the exact
sentence, and reports `claim_not_located` when it cannot. Numerical
traceability is still a word-boundary name match, which is a heuristic, not a
proof. There is still no "View source" action directly from the Claims tab, and
still no deterministic hypothesis↔result wording comparison — nothing stores a
computed result per hypothesis, which Phase 20 reports as `not_computable`
rather than working around. ORCID is validated but not persisted.

See `docs/PHASE_19_RESEARCH_INTEGRITY_CITATION_VERIFICATION.md` §18-19 for
detail.

**Phase 20:** no structured per-hypothesis analysis result is stored, so
`result_traceability` is permanently `not_computable`; closing it is a schema
change. Legacy jsonb framework graphs in `research_frameworks` are preserved
and left unmapped — a label identical to a construct's name is still reported
as unmapped, because matching them by string would be an invented mapping. The
framework has no visual diagram (the list is the interface at every width) and
its layout coordinates are stored but not yet editable. Real-browser
verification needs a local Supabase stack and an installed Chrome. The live AI
benchmark remains the only deferred gate.

See `docs/PHASE_20_RESEARCH_INTELLIGENCE_VALIDATION.md` §18-19 for detail.

**Phase 21:** the clean bootstrap is closed — `supabase db reset` applies all
26 migrations from an empty database with no manual step, and all six
isolation suites pass against that database rather than an accreted one. The
dry benchmark can no longer overwrite the live provider record, and the
committed record is now labelled for what it is: a successful credential probe
plus a smoke run whose twelve calls all came back `UNAVAILABLE`, not a
completed live benchmark. The framework's stored layout is editable and
persists; the source search built in Phase 20 finally has a caller, so the
Sources tab no longer loads the whole library to filter it in the browser.

Still open. The browser suite is not in CI — it needs a built app, a Supabase
stack and a real Chrome, so it stays a local gate (71 tests, six widths,
executed). The CI workflow itself is new and has never run: there is no
Actions runner in this environment, so its green-ness is an expectation rather
than a result. Performance budgets are local measurements against Docker
Postgres, good for catching a plan regression and not a statement about
production latency. Operational events have one sink (`console`) and are wired
into three routes; nothing aggregates or alerts on them. The framework still
has no visual diagram. The live AI benchmark remains the only deferred gate.

See `docs/PHASE_21_PRODUCTION_REPRODUCIBILITY_WORKSPACE_HARDENING.md` §13-15
for detail.
