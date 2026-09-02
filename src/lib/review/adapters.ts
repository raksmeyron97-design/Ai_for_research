import type { MethodologyEntityKind, MethodologyFinding } from "../methodology/types";
import type { IntegrityFinding } from "../integrity/types";
import type { ReviewCategory, ReviewFinding, ReviewTargetType } from "./types";

/**
 * Phase 18's and Phase 19's findings, expressed in Phase 20's vocabulary.
 *
 * This is the alternative to re-implementing their checks, and it is the
 * whole reason the cross-system review is not a second source of truth
 * (§2.3). `runConsistencyChecks` and `buildResearchIntegrityReview` remain
 * the only places those rules live; the system review re-labels what they
 * already found and adds only the edges neither of them can see — the ones
 * that cross from one subsystem into another.
 *
 * Ids are prefixed rather than rewritten. A Phase 18 finding keeps its own
 * identity inside a `methodology:` namespace, so a researcher's decision
 * recorded against it in the methodology workspace and the same finding seen
 * here are traceably the same thing, and the two can never collide with a
 * Phase 20 id.
 */

/**
 * Phase 18 groups by the rule that fired; Phase 20 groups by the area a
 * researcher would go to fix it. Several rules therefore land in one
 * category, which is intended — §22 warns against inventing hundreds of them.
 */
const METHODOLOGY_CATEGORY: Record<string, ReviewCategory> = {
  analysis_plan: "analysis",
  construct_naming: "methodology",
  definition: "methodology",
  hypothesis_structure: "methodology",
  hypothesis_traceability: "traceability",
  question_objective_alignment: "methodology",
  provenance: "provenance",
  // Everything the questionnaire engine reports is acted on in the
  // questionnaire builder, whether it is about the mapping, the wording, the
  // scale or a redundant pair.
  measurement_chain: "questionnaire",
  measurement_coverage: "questionnaire",
  measurement_mapping: "questionnaire",
  item_wording: "questionnaire",
  redundancy: "questionnaire",
  response_scale: "questionnaire",
};

const METHODOLOGY_TARGET: Record<MethodologyEntityKind, ReviewTargetType> = {
  research_question: "research_question",
  objective: "objective",
  construct: "construct",
  indicator: "indicator",
  hypothesis: "hypothesis",
  questionnaire_item: "questionnaire_item",
  // A scale is a property of measurement, and there is no scale view to open;
  // the questionnaire is where a scale problem is acted on.
  scale: "questionnaire_item",
  analysis_plan: "analysis",
  project: "project",
};

export function fromMethodologyFinding(finding: MethodologyFinding): ReviewFinding {
  return {
    id: `methodology:${finding.id}`,
    category: METHODOLOGY_CATEGORY[finding.category] ?? "methodology",
    severity: finding.severity,
    title: finding.title,
    explanation: finding.explanation,
    targetType: METHODOLOGY_TARGET[finding.targetType] ?? "project",
    targetId: finding.targetId,
    // Phase 18's provenance carries the four-word methodology vocabulary
    // ('user', 'source_stated', ...) as well as 'deterministic'. Only the
    // deterministic/ai_suggested distinction matters here, and §23 forbids
    // widening an AI proposal into anything stronger, so anything that is not
    // literally deterministic is treated as a proposal.
    provenance: finding.provenance === "deterministic" ? "deterministic" : "ai_suggested",
    remediation: finding.remediation,
  };
}

const INTEGRITY_CATEGORY: Record<string, ReviewCategory> = {
  citation: "citations",
  evidence: "evidence",
  source: "literature",
  reference: "literature",
  methodology: "methodology",
  numerical: "analysis",
  provenance: "provenance",
};

const INTEGRITY_TARGET: Record<string, ReviewTargetType> = {
  claim: "claim",
  citation: "citation",
  evidence: "evidence",
  source: "source",
  reference: "citation",
  construct: "construct",
  hypothesis: "hypothesis",
  section: "section",
};

export function fromIntegrityFinding(finding: IntegrityFinding): ReviewFinding {
  return {
    id: `integrity:${finding.id}`,
    category: INTEGRITY_CATEGORY[finding.category] ?? "traceability",
    severity: finding.severity,
    title: finding.title,
    explanation: finding.explanation,
    targetType: INTEGRITY_TARGET[finding.targetType] ?? "project",
    targetId: finding.targetId,
    provenance: finding.provenance,
    remediation: finding.remediation,
  };
}
