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
| 18 | Advanced Methodology & Questionnaire Intelligence | NOT STARTED |

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

**Phase 17B:** conceptual framework *editor* (validation exists, the editor
does not) and source search/filter across a large library remain open. The
responsive layout has no real-browser pass — jsdom does not apply the Tailwind
breakpoints. Claim offsets drift when the paragraph is edited; comparison is
capped at five sources; theme suggestion reads bibliographic lines rather than
full text.

See `docs/PHASE_17B_EVIDENCE_LITERATURE_WORKSPACE.md` §14 for detail, and
`docs/PHASE_17_EVIDENCE_LITERATURE_WORKSPACE.md` for the underlying model.
