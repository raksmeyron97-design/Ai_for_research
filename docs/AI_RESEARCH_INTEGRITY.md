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

## What's enforced today vs. what's prompted-for

Being direct about the current limits, since a prompt instruction is not
the same as a code-level guarantee:

- **Enforced by prompt only, not yet by code**: everything above is
  currently a system-instruction constraint the model is asked to follow.
  There is no structured-output schema forcing every claim to carry an
  `EvidenceStatus`, and no automated check that rejects a response
  containing numbers when no dataset was attached. That validation layer
  is Phase 5 (`ResearchIntegrityGuard` as a code component, `Citation`/
  `ResearchWarning` structured parsing) — `types.ts` already defines the
  shapes (`EvidenceStatus`, `Citation`, `ResearchWarning`) so Phase 5 can
  slot in without a contract change.
- **Enforced by code today**: the guard text itself cannot be omitted
  (it's not a parameter, it's concatenated unconditionally in
  `buildSystemInstruction`), and dual-model verification
  (`AIOrchestrator.attachVerification`) gives a second model a chance to
  flag unsupported claims in the first model's output for
  `methodology_audit`, `quality_check`, and `research_gap` tasks.

## Practical implication for anyone extending this

Don't treat a model response's prose claims of "VERIFIED" as proof of
anything — that label is currently the model self-reporting per
instructions, not a system that checked a database. Treat all AI output
as a draft for the researcher to review until Phase 5's structured
validation lands.
