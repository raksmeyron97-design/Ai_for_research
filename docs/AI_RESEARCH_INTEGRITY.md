# AI Research Integrity

This is the non-negotiable part of the system (spec §15, §18, §19, §59):
the assistant recommends, the researcher decides, and nothing AI-generated
is silently treated as verified research evidence.

## The guard

`src/lib/ai/research-integrity-guard.ts` exports
`RESEARCH_INTEGRITY_INSTRUCTIONS`, which `prompt-manager.ts` appends to
**every** system instruction, for every task type, with no opt-out. The
rules it enforces:

1. Never invent participants, sample sizes, results, percentages, means,
   SDs, p-values, confidence intervals, findings, ethics approvals, or
   validation claims.
2. Never invent citations — authors, titles, journals, years, DOIs. If a
   citation can't be verified, say so instead of presenting it as fact.
3. Label non-trivial claims with one of: `VERIFIED`, `SOURCE_REQUIRED`,
   `USER_PROVIDED`, `INFERENCE`, `UNVERIFIED` (`EvidenceStatus` in
   `types.ts`).
4. If asked for results/analysis with no dataset in context, don't
   produce numbers — offer structure (tables, placeholders, an analysis
   plan) and say plainly that real data is required.
5. When uncertain, say "this requires verification" rather than guessing
   confidently.

## What's enforced by code today vs. what's still prompt-only

Being direct about the current limits, since a prompt instruction is not
the same as a code-level guarantee. Phase 5 (`src/lib/ai/integrity-guard.ts`,
see `AI_RESEARCH_INTELLIGENCE.md` for the full writeup) closed two of
these gaps with real code, verified against a real database — but not
all of them; this list is deliberately not "mostly done" just because
some items moved.

- **Enforced by code (Phase 5)**:
  - Rule 4 (no results without a dataset) — `requiresDataset()` blocks
    `results_generation`/`data_analysis` requests with no `dataSetId`
    *before any model is called*, in both `AIOrchestrator` and both
    `/api/ai/*` routes. Verified end-to-end against a real local
    Supabase instance: the guard fires, the safe response is returned,
    and no provider is ever invoked (confirmed via server logs +
    database — no API key needed for this path, since it short-circuits
    before reaching one).
  - Part of rule 2 (citations) — `verifyCitationKeys()` cross-checks any
    `[citation_key]`-form reference against real `research_citations`
    rows and flags ones that don't resolve. Only catches the bracket
    convention, not citations mentioned as plain prose — see the
    intelligence doc's "Limits, stated plainly."
- **Still enforced by prompt only, not by code**:
  - Rule 1 for anything *not* covered by the dataset guard — a
    fabricated statistic inside a `chat` or `discussion` response (as
    opposed to a dedicated results/analysis request) has no code-level
    check.
  - Rule 3 — nothing verifies a model's self-reported `EvidenceStatus`
    label (`VERIFIED`, etc.) against an actual source; the model is
    still just asked to label things honestly.
  - Ethics-approval / validated-instrument claims (rule 1's tail, spec
    §18/§26) have no code-level check.
  - The guard text itself, however, *is* enforced by code (not new to
    Phase 5): it cannot be omitted — it's concatenated unconditionally
    in `buildSystemInstruction`, not a parameter a caller could skip.
    Dual-model verification (`AIOrchestrator.attachVerification`) also
    still applies for `methodology_audit`, `quality_check`, and
    `research_gap` tasks.

## Practical implication for anyone extending this

Don't treat a model response's prose claim of "VERIFIED" as proof of
anything — outside the two checks listed above, that label is still the
model self-reporting per instructions, not a system that checked a
database. Treat AI output as a draft for the researcher to review, and
check `AI_RESEARCH_INTELLIGENCE.md`'s gap list before assuming a new
category of claim is covered.
