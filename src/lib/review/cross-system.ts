import type {
  ResearchClaimEvidenceRow,
  ResearchClaimMethodologyLinkRow,
  ResearchClaimRow,
  ResearchEvidenceRow,
} from "../db/types";
import type { MethodologyModel } from "../methodology/model";
import type { ReviewFinding, ReviewMetric } from "./types";
import { ratioMetric } from "./types";

/**
 * The edges neither Phase 18 nor Phase 19 can see.
 *
 * Everything here is deliberately narrow. Phase 18 owns the methodology
 * chain, Phase 19 owns the claim/citation/evidence chain, and re-checking
 * either from here would give a researcher the same finding twice under two
 * names. What is left is the handful of edges that cross *between* the two
 * subsystems, or that sit at the outer end of a chain neither engine walks to
 * the finish.
 *
 * Each check below says which existing engine it is careful not to overlap.
 */

/**
 * Evidence extracted from a source that supports nothing.
 *
 * Phase 19's `findUnusedReferences` reports a *source* nobody cites. This is
 * the step after that: the source is cited, an excerpt was pulled from it,
 * and then no claim was ever attached to the excerpt. That is work the
 * researcher did and lost track of, and it is invisible from either end —
 * the reference looks used, and the claim list looks complete.
 *
 * `info`, not `warning`. Collecting evidence before writing the sentence it
 * supports is ordinary practice, and a note that fires while someone is
 * mid-literature-review must not read as an error.
 */
function orphanEvidenceFindings(
  evidence: Pick<ResearchEvidenceRow, "id" | "excerpt" | "citation_id">[],
  claimEvidence: Pick<ResearchClaimEvidenceRow, "evidence_id">[],
): ReviewFinding[] {
  const used = new Set(claimEvidence.map((ce) => ce.evidence_id));

  return evidence
    .filter((e) => !used.has(e.id))
    .map((e) => ({
      id: `traceability:evidence-supports-nothing:${e.id}`,
      category: "evidence" as const,
      severity: "info" as const,
      title: "Evidence supports no claim",
      explanation:
        `This excerpt was saved from a source but no claim in the manuscript is linked to it: ` +
        `"${e.excerpt.slice(0, 120)}${e.excerpt.length > 120 ? "…" : ""}"`,
      targetType: "evidence" as const,
      targetId: e.id,
      relatedTo: { type: "source" as const, id: e.citation_id },
      provenance: "deterministic" as const,
      remediation: "Link this evidence to the claim it supports, or remove it if it is no longer relevant.",
    }));
}

/**
 * A claim that is cited but tied to no part of the methodology.
 *
 * Phase 19's `hypothesis-no-manuscript-claim` looks from the hypothesis
 * outwards and asks "is this hypothesis discussed anywhere?". This looks from
 * the claim inwards and asks "does this sentence connect to the study's own
 * design?" — the reverse direction §16 requires, and a different gap: a
 * findings claim can be perfectly well cited to the literature while relating
 * to no construct this study measured.
 *
 * Restricted to the sections where a claim is expected to be about *this*
 * study. In a literature review a claim about someone else's work is the
 * point, and flagging it would fire on every sentence of the chapter.
 */
const OWN_STUDY_SECTIONS = new Set(["results", "discussion", "conclusion"]);

function unlinkedClaimFindings(
  claims: Pick<ResearchClaimRow, "id" | "claim_text" | "section_type" | "claim_type">[],
  methodologyLinks: Pick<ResearchClaimMethodologyLinkRow, "claim_id">[],
  methodology: MethodologyModel,
): ReviewFinding[] {
  // With no constructs and no hypotheses there is nothing a claim could be
  // linked *to*, so the finding would be about the empty methodology rather
  // than about the claim. Phase 18 already reports that.
  if (methodology.constructs.length === 0 && methodology.hypotheses.length === 0) return [];

  const linked = new Set(methodologyLinks.map((l) => l.claim_id));

  return claims
    .filter((c) => OWN_STUDY_SECTIONS.has(c.section_type) && !linked.has(c.id))
    .map((claim) => ({
      id: `traceability:claim-not-linked-to-methodology:${claim.id}`,
      category: "traceability" as const,
      severity: "info" as const,
      title: "Claim is not linked to the methodology",
      explanation:
        `This ${claim.section_type} claim is not tied to any construct, hypothesis or objective, ` +
        `so nothing connects it to what the study set out to measure.`,
      targetType: "claim" as const,
      targetId: claim.id,
      provenance: "deterministic" as const,
      remediation: "Link this claim to the construct or hypothesis it reports on.",
    }));
}

export function runCrossSystemChecks(input: {
  claims: Pick<ResearchClaimRow, "id" | "claim_text" | "section_type" | "claim_type">[];
  evidence: Pick<ResearchEvidenceRow, "id" | "excerpt" | "citation_id">[];
  claimEvidence: Pick<ResearchClaimEvidenceRow, "evidence_id">[];
  methodologyLinks: Pick<ResearchClaimMethodologyLinkRow, "claim_id">[];
  methodology: MethodologyModel;
}): { findings: ReviewFinding[]; metrics: ReviewMetric[] } {
  const findings = [
    ...orphanEvidenceFindings(input.evidence, input.claimEvidence),
    ...unlinkedClaimFindings(input.claims, input.methodologyLinks, input.methodology),
  ];

  const ownStudyClaims = input.claims.filter((c) => OWN_STUDY_SECTIONS.has(c.section_type));
  const linkedClaims = new Set(input.methodologyLinks.map((l) => l.claim_id));
  const usedEvidence = new Set(input.claimEvidence.map((ce) => ce.evidence_id));

  const metrics: ReviewMetric[] = [
    ratioMetric(
      ownStudyClaims.filter((c) => linkedClaims.has(c.id)).length,
      ownStudyClaims.length,
      {
        id: "methodology_traceability",
        label: "Claims linked to methodology",
        category: "traceability",
        ok: "Results, discussion and conclusion claims tied to a construct, hypothesis or objective.",
        empty: "No claims have been extracted from the results, discussion or conclusion yet.",
      },
    ),
    ratioMetric(
      input.evidence.filter((e) => usedEvidence.has(e.id)).length,
      input.evidence.length,
      {
        id: "evidence_utilisation",
        label: "Evidence used by a claim",
        category: "evidence",
        ok: "Saved excerpts that are linked to at least one claim.",
        empty: "No evidence has been saved yet.",
      },
    ),
  ];

  return { findings, metrics };
}
