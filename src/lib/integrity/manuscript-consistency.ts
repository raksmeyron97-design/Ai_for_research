import { contentWords } from "../evidence/ranking";
import { normalisedName, runConsistencyChecks } from "../methodology/consistency";
import type { MethodologyModel } from "../methodology/model";
import type {
  ResearchClaimMethodologyLinkRow,
  ResearchClaimRow,
  ResearchConstructRow,
  SectionType,
} from "../db/types";
import type { IntegrityFinding } from "./types";

/**
 * §16-§18: manuscript <-> methodology consistency.
 *
 * This module adds three checks specific to prose-vs-model drift (causal
 * language, construct terminology, hypothesis-to-claim traceability), and
 * relays Phase 18's own `runConsistencyChecks` findings through unchanged —
 * methods/questionnaire/analysis-plan consistency already has a working
 * ruleset, and duplicating it here would risk it scoring differently from
 * Phase 18's own tests of the same rules.
 */

const SECTIONS_DISCUSSING_RESULTS: SectionType[] = ["results", "discussion", "conclusion"];

/**
 * Short on purpose, matching the discipline `RELATIONSHIP_INCAPABLE` in
 * `methodology/consistency.ts` already sets: only phrasing that plainly
 * asserts causation, not anything merely correlational-sounding.
 */
const CAUSAL_LANGUAGE = /\b(caused?|causes|causing|led to|leads to|resulted in|results? in)\b/i;

function reviewCausalLanguage(
  claims: Pick<ResearchClaimRow, "id" | "claim_text" | "section_type">[],
  model: MethodologyModel,
): IntegrityFinding[] {
  const hasCausalDesign = model.questions.some((q) => q.question_kind === "causal");
  if (hasCausalDesign) return [];

  return claims
    .filter((c) => SECTIONS_DISCUSSING_RESULTS.includes(c.section_type))
    .filter((c) => CAUSAL_LANGUAGE.test(c.claim_text))
    .map((c) => ({
      id: `methodology:causal-language:${c.id}`,
      category: "methodology" as const,
      severity: "warning" as const,
      title: "Potential causal-language inconsistency",
      explanation:
        "This claim uses causal language, but the methodology model does not currently describe a causal design — no research question is classified as causal.",
      targetType: "claim",
      targetId: c.id,
      provenance: "deterministic" as const,
      remediation: "Confirm the design supports causal language, or soften the wording to an associational finding.",
    }));
}

/**
 * A claim using a near-duplicate of a construct's name (same content words,
 * different order or pluralization) without ever using the construct's own
 * name — the same crude, deliberate heuristic `consistency.ts` already uses
 * for near-duplicate construct names, applied here to prose instead of a
 * second construct row.
 */
function reviewConstructTerminology(
  claims: Pick<ResearchClaimRow, "id" | "claim_text" | "section_type">[],
  constructs: Pick<ResearchConstructRow, "id" | "name">[],
): IntegrityFinding[] {
  const findings: IntegrityFinding[] = [];

  for (const construct of constructs) {
    const constructWords = contentWords(construct.name);
    if (constructWords.length === 0) continue;
    const constructKey = normalisedName(construct.name);
    const lowerName = construct.name.toLowerCase();

    for (const claim of claims) {
      if (!SECTIONS_DISCUSSING_RESULTS.includes(claim.section_type)) continue;
      if (claim.claim_text.toLowerCase().includes(lowerName)) continue;

      const claimWords = contentWords(claim.claim_text);
      let drift = false;
      for (let i = 0; i + constructWords.length <= claimWords.length && !drift; i++) {
        const window = claimWords.slice(i, i + constructWords.length);
        if (normalisedName(window.join(" ")) === constructKey) drift = true;
      }

      if (drift) {
        findings.push({
          id: `methodology:construct-terminology:${construct.id}:${claim.id}`,
          category: "methodology",
          severity: "info",
          title: "Construct terminology differs from the canonical methodology model",
          explanation: `This claim uses wording close to "${construct.name}" without using the construct's own name — worth confirming they refer to the same thing.`,
          targetType: "claim",
          targetId: claim.id,
          provenance: "deterministic",
          remediation: "Use the construct's stated name, or confirm this is a different concept.",
        });
      }
    }
  }

  return findings;
}

/**
 * The deterministic half of hypothesis <-> results consistency (§17): is
 * there any manuscript claim traced to this hypothesis at all. Comparing
 * the manuscript's *wording strength* against the recorded result is
 * AI-advisory only (see `suggestions.ts`'s `compareWordingToResult`) —
 * nothing in the schema stores a computed result or p-value per hypothesis
 * to check that deterministically against.
 */
function reviewHypothesisTraceability(
  model: MethodologyModel,
  methodologyLinks: Pick<ResearchClaimMethodologyLinkRow, "hypothesis_id">[],
): IntegrityFinding[] {
  const linkedHypothesisIds = new Set(
    methodologyLinks.flatMap((l) => (l.hypothesis_id ? [l.hypothesis_id] : [])),
  );

  return model.hypotheses
    .filter((h) => !linkedHypothesisIds.has(h.id))
    .map((h) => ({
      id: `methodology:hypothesis-no-manuscript-claim:${h.id}`,
      category: "methodology" as const,
      severity: "info" as const,
      title: "No manuscript claim traces to this hypothesis yet",
      explanation: `${h.label ?? "This hypothesis"} has no claim in the manuscript linked to it, so its outcome cannot be traced from the Results or Discussion text.`,
      targetType: "hypothesis",
      targetId: h.id,
      provenance: "deterministic" as const,
      remediation: "Link the claim in Results or Discussion that reports this hypothesis's outcome.",
    }));
}

function relayMethodologyFindings(model: MethodologyModel): IntegrityFinding[] {
  return runConsistencyChecks(model).findings.map((f) => ({
    id: `methodology:${f.id}`,
    category: "methodology",
    severity: f.severity,
    title: f.title,
    explanation: f.explanation,
    targetType: f.targetType,
    targetId: f.targetId,
    provenance: "deterministic",
    remediation: f.remediation,
  }));
}

export function buildManuscriptConsistencyFindings(
  claims: Pick<ResearchClaimRow, "id" | "claim_text" | "section_type">[],
  model: MethodologyModel,
  methodologyLinks: Pick<ResearchClaimMethodologyLinkRow, "hypothesis_id">[],
): IntegrityFinding[] {
  return [
    ...reviewCausalLanguage(claims, model),
    ...reviewConstructTerminology(claims, model.constructs),
    ...reviewHypothesisTraceability(model, methodologyLinks),
    ...relayMethodologyFindings(model),
  ];
}
