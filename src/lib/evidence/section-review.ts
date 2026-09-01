import type { ResearchClaimRow, ResearchSectionRow, SectionType } from "../db/types";
import { SECTION_LABELS } from "../db/types";
import { getContextPolicy } from "../ai/sections/context-policy";
import { computeCoverage, type CoverageBreakdown } from "./status";

/**
 * Section health, computed rather than asked for (§16).
 *
 * Every score here comes from counting something. That is the requirement:
 * `quality-check.ts` asks a model for seven 0-100 numbers, which is fine as a
 * second opinion but cannot be shown to a researcher as "evidence coverage
 * 70%" — they would reasonably assume the 70 means something countable, and
 * it would not.
 *
 * Where a dimension genuinely cannot be computed, it reports null rather than
 * a plausible number. "We don't measure this" is a better answer than a
 * confident invention.
 */
export type FindingSeverity = "HIGH" | "MEDIUM" | "LOW";

export interface ReviewFinding {
  severity: FindingSeverity;
  section: SectionType;
  /** The claim this concerns, when it concerns one. */
  claim?: string;
  reason: string;
  recommendation: string;
  /** Machine-readable next step, so the UI can offer a button rather than prose. */
  action: "find_evidence" | "verify_citation" | "write_content" | "review_alignment" | "none";
}

export interface SectionHealth {
  section: SectionType;
  /** 0-1 each, or null when not computable for this section. */
  completeness: number | null;
  evidenceCoverage: number | null;
  researchAlignment: number | null;
  citationIntegrity: number | null;
  coverage: CoverageBreakdown;
  findings: ReviewFinding[];
  /** How each score was derived, shown next to it. */
  explanations: Record<string, string>;
}

/**
 * Rough target lengths per section, used only for the completeness signal.
 * A word count is a weak proxy for completeness and is treated as one: it
 * contributes a capped score and never produces a finding on its own beyond
 * "this is still empty".
 */
const TARGET_WORDS: Partial<Record<SectionType, number>> = {
  title: 15,
  research_problem: 300,
  rationale: 250,
  research_gap: 250,
  objectives: 120,
  research_questions: 100,
  variables: 150,
  conceptual_framework: 150,
  methodology: 400,
  data_collection: 200,
  data_analysis: 200,
  results: 400,
  discussion: 400,
  conclusion: 200,
  recommendations: 150,
};

function countWords(text: string): number {
  const latin = (text.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g) ?? []).length;
  // Khmer has no inter-word spaces, so a space-split count would read every
  // Khmer section as nearly empty.
  const khmer = [...text].filter((c) => /[ក-៿]/.test(c)).length;
  return latin + Math.ceil(khmer / 4);
}

export interface SectionReviewInput {
  section: SectionType;
  sectionRow: ResearchSectionRow | undefined;
  claims: ResearchClaimRow[];
  /** Prior sections that exist with content, from the section's own context policy. */
  presentPriorSections: SectionType[];
  /** Citation keys in the section text that resolve to a saved source. */
  resolvedCitationKeys: string[];
  /** Citation keys that resolve to nothing — the integrity problem. */
  unresolvedCitationKeys: string[];
}

export function reviewSection(input: SectionReviewInput): SectionHealth {
  const content = input.sectionRow?.content ?? "";
  const words = countWords(content);
  const findings: ReviewFinding[] = [];
  const explanations: Record<string, string> = {};

  // --- completeness -----------------------------------------------------
  const target = TARGET_WORDS[input.section];
  let completeness: number | null = null;
  if (target) {
    completeness = Math.min(1, words / target);
    explanations.completeness = `${words} words against a rough target of ${target} for ${SECTION_LABELS[input.section]}. A word count is a weak proxy and is capped at 100%.`;
  } else {
    explanations.completeness = "Completeness is not estimated for this section.";
  }

  if (words === 0) {
    findings.push({
      severity: "HIGH",
      section: input.section,
      reason: "This section has no content yet.",
      recommendation: `Draft ${SECTION_LABELS[input.section]}, or use AI Assist to generate a starting point.`,
      action: "write_content",
    });
  }

  // --- evidence coverage -------------------------------------------------
  const coverage = computeCoverage(input.claims);
  explanations.evidenceCoverage = coverage.explanation;

  for (const claim of input.claims) {
    if (!claim.needs_evidence) continue;
    if (claim.evidence_status === "UNSUPPORTED") {
      findings.push({
        severity: "HIGH",
        section: input.section,
        claim: claim.claim_text,
        reason: "The evidence attached to this claim does not support it.",
        recommendation: "Find supporting evidence, or soften the claim to what the sources show.",
        action: "find_evidence",
      });
    } else if (claim.evidence_status === "NEEDS_VERIFICATION") {
      findings.push({
        severity: "MEDIUM",
        section: input.section,
        claim: claim.claim_text,
        reason: "This claim needs evidence and none has been verified yet.",
        recommendation: "Use Find Evidence to attach a source, then confirm it supports the claim.",
        action: "find_evidence",
      });
    }
  }

  // --- research alignment ------------------------------------------------
  const policy = getContextPolicy(input.section);
  let researchAlignment: number | null = null;
  if (policy.priorSections.length > 0) {
    researchAlignment = input.presentPriorSections.length / policy.priorSections.length;
    explanations.researchAlignment =
      `${input.presentPriorSections.length} of ${policy.priorSections.length} sections this one must follow from have content. ` +
      `This measures whether the chain exists, not whether the content agrees — that is what Check alignment does.`;

    const missing = policy.priorSections.filter((s) => !input.presentPriorSections.includes(s));
    if (missing.length > 0 && words > 0) {
      findings.push({
        severity: "MEDIUM",
        section: input.section,
        reason: `This section is written but ${missing.map((s) => SECTION_LABELS[s]).join(", ")} ${missing.length === 1 ? "is" : "are"} still empty.`,
        recommendation: "Write the earlier sections first, or check this one still follows from them.",
        action: "review_alignment",
      });
    }
  } else {
    explanations.researchAlignment = "This section does not follow from earlier sections.";
  }

  // --- citation integrity ------------------------------------------------
  const totalKeys = input.resolvedCitationKeys.length + input.unresolvedCitationKeys.length;
  let citationIntegrity: number | null = null;
  if (totalKeys > 0) {
    citationIntegrity = input.resolvedCitationKeys.length / totalKeys;
    explanations.citationIntegrity = `${input.resolvedCitationKeys.length} of ${totalKeys} citation keys in this section resolve to a saved source.`;

    for (const key of input.unresolvedCitationKeys) {
      findings.push({
        severity: "HIGH",
        section: input.section,
        reason: `Citation "${key}" does not match any saved source in this project.`,
        recommendation: "Add the source to your library, or remove the reference.",
        action: "verify_citation",
      });
    }
  } else {
    explanations.citationIntegrity = "No citations in this section yet.";
  }

  const severityRank = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return {
    section: input.section,
    completeness,
    evidenceCoverage: coverage.coverage,
    researchAlignment,
    citationIntegrity,
    coverage,
    findings,
    explanations,
  };
}
