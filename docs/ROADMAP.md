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
| 16B | Live Gemini vs OpenAI benchmark | **DEFERRED** |
| 16 (workflow) | Section-aware research workflow, change control, versioning | COMPLETE |
| 17 | Advanced Evidence & Literature Workspace (model + deterministic review) | COMPLETE |
| 17B | Researcher-facing evidence & literature workspace | COMPLETE |
| 18 | Advanced Methodology & Questionnaire Intelligence | COMPLETE |

## Live AI benchmark: DEFERRED

**Reason:** feature-completion priority and credit conservation.

Everything needed to run it is in place — 80 scenarios across three routing
groups driving the full production path, verified provider pricing, and budget
rails. The only blocker is provider billing credit. Projected cost for the
full comparison is $1.87-$3.24, or $3.75-$6.47 with the blind judge.

To run it: `npm run ai:benchmark:smoke` first (~12 calls, cents), then
`AI_BENCH_MAX_REQUESTS=1800 AI_BENCH_MAX_COST_USD=15 npm run ai:benchmark:compare`.

## Open gaps by phase

**Phase 16 (workflow):** evidence insertion cards, section review panel
(closed in 17), conceptual framework editor, mobile layout (closed in 17),
version history UI (closed in 17), component tests (closed in 17).

**Phase 17:** closed by 17B — evidence cards and the insertion flow, claim
extraction, source comparison, themes, the research gap matrix, and the review
and version-history panes are now mounted in the editor.

**Phase 17B:** source search/filter across a large library remains open. Claim
offsets drift when the paragraph is edited; comparison is capped at five
sources; theme suggestion reads bibliographic lines rather than full text.

See `docs/PHASE_17B_EVIDENCE_LITERATURE_WORKSPACE.md` §14 for detail, and
`docs/PHASE_17_EVIDENCE_LITERATURE_WORKSPACE.md` for the underlying model.

**Phase 18:** the conceptual-framework editor is still open — Phase 18 created
the canonical constructs a framework node should reference, but
`research_frameworks.graph` still stores free-text labels. Linguistic item
checks are heuristics, statistical compatibility is advisory, and psychometric
validity cannot be inferred without data. The responsive layout still has no
real-browser pass: jsdom does not apply the Tailwind breakpoints, so structure
is verified and the rendered result at 320/375/414px is not.

See `docs/PHASE_18_METHODOLOGY_QUESTIONNAIRE_INTELLIGENCE.md` §15 for detail,
and `docs/PHASE_18_METHODOLOGY_AUDIT.md` for the model decisions.
