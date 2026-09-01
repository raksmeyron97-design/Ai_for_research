import type { ClaimType, EvidenceStatusLabel, ResearchClaimRow, SupportLabel } from "../db/types";

/**
 * Deterministic evidence logic. No model is consulted anywhere in this file.
 *
 * Phase 17 §6 and §18 hinge on the same thing: a status or a percentage a
 * model produced is not explainable, and an explainable one has to be derived
 * from something countable. So the rules live here, as plain functions the
 * review panel and the tests both call.
 */

/**
 * Which claim types are expected to carry evidence.
 *
 * §5 is explicit that not every sentence needs a citation. An interpretive
 * claim ("this suggests screening may help earlier") is the researcher's own
 * reading; a user-provided claim is their own data; an inference is labelled
 * as one. Counting those against coverage would push a researcher toward
 * citing things that do not need citing — worse writing, not better.
 */
const EVIDENCE_REQUIRING: ClaimType[] = ["factual", "statistical", "clinical", "comparative"];

export function claimNeedsEvidence(type: ClaimType): boolean {
  return EVIDENCE_REQUIRING.includes(type);
}

/** The status a claim starts with, before any evidence is attached. */
export function initialStatusFor(type: ClaimType): EvidenceStatusLabel {
  if (type === "user_provided") return "USER_PROVIDED";
  if (type === "inference" || type === "interpretive") return "INFERENCE";
  return "NEEDS_VERIFICATION";
}

/**
 * The only path to SUPPORTED.
 *
 * §6's rule is that NEEDS_VERIFICATION must never silently become SUPPORTED.
 * Enforced by deriving status purely from the support judgements on linked
 * evidence — there is no branch that upgrades a claim because evidence merely
 * *exists*. A link whose support is NEEDS_REVIEW leaves the claim needing
 * verification, which is the case that matters: attaching a source is not the
 * same as checking it.
 */
export function deriveClaimStatus(type: ClaimType, supports: SupportLabel[]): EvidenceStatusLabel {
  // Claim types carrying their own provenance keep it regardless of what is
  // attached: an inference does not become a fact by citing something.
  if (type === "user_provided") return "USER_PROVIDED";
  if (type === "inference" || type === "interpretive") return "INFERENCE";

  if (supports.length === 0) return "NEEDS_VERIFICATION";
  if (supports.some((s) => s === "NEEDS_REVIEW")) return "NEEDS_VERIFICATION";

  if (supports.some((s) => s === "SUPPORTED")) {
    // A supporting source alongside a contradicting or partial one is not a
    // settled claim.
    return supports.every((s) => s === "SUPPORTED") ? "SUPPORTED" : "PARTIALLY_SUPPORTED";
  }
  if (supports.some((s) => s === "PARTIAL")) return "PARTIALLY_SUPPORTED";

  return "UNSUPPORTED";
}

export interface CoverageBreakdown {
  /** Claims that require evidence — the denominator, and it is a count of rows. */
  requiring: number;
  supported: number;
  partiallySupported: number;
  unsupported: number;
  needsVerification: number;
  /** 0-1, or null when nothing requires evidence: 0% and "not applicable" are different. */
  coverage: number | null;
  /** Plain-language explanation of exactly how the number was reached. */
  explanation: string;
}

/**
 * Evidence coverage, computed from claim rows.
 *
 * Partially supported claims count as half. Counting them as supported
 * overstates; counting them as unsupported understates and discourages the
 * honest PARTIAL judgement. Half is a convention, not a measurement — so
 * `explanation` says so rather than letting a reader assume precision that is
 * not there.
 */
export function computeCoverage(
  claims: Pick<ResearchClaimRow, "needs_evidence" | "evidence_status">[],
): CoverageBreakdown {
  const requiring = claims.filter((c) => c.needs_evidence);
  const count = (status: EvidenceStatusLabel) => requiring.filter((c) => c.evidence_status === status).length;

  const supported = count("SUPPORTED");
  const partiallySupported = count("PARTIALLY_SUPPORTED");
  const unsupported = count("UNSUPPORTED");
  const needsVerification = count("NEEDS_VERIFICATION");

  if (requiring.length === 0) {
    return {
      requiring: 0,
      supported: 0,
      partiallySupported: 0,
      unsupported: 0,
      needsVerification: 0,
      coverage: null,
      explanation: "No claims in this section require evidence, so coverage does not apply.",
    };
  }

  return {
    requiring: requiring.length,
    supported,
    partiallySupported,
    unsupported,
    needsVerification,
    coverage: (supported + partiallySupported * 0.5) / requiring.length,
    explanation:
      `${requiring.length} claim(s) require evidence: ${supported} supported, ` +
      `${partiallySupported} partially supported (counted as half), ${unsupported} unsupported, ` +
      `${needsVerification} still to verify.`,
  };
}
