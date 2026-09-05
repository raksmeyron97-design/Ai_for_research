import { extractCitationKeys } from "../ai/integrity-guard";
import { claimNeedsEvidence } from "../evidence/status";
import type {
  ResearchCitationRow,
  ResearchClaimEvidenceRow,
  ResearchClaimRow,
  ResearchEvidenceRow,
  SupportLabel,
} from "../db/types";

/**
 * A claim's citation, deterministically classified. Distinct from
 * `EvidenceStatusLabel` (which lives on the claim row and answers "is this
 * claim supported") — this answers a narrower question: "does the citation
 * this claim points at actually resolve, and to what". A claim can be
 * UNSUPPORTED yet its citation still `verified` as a citation (wrong source,
 * cited correctly) — the two questions are related but not the same one.
 */
export type CitationVerificationState =
  | "verified" // resolves to a saved source, linked evidence, every link SUPPORTED
  | "partial" // resolves, linked evidence exists, support is mixed or PARTIAL
  | "unsupported" // resolves to a saved source, but no evidence link supports it
  | "missing" // needs evidence; no citation key in the claim text and no evidence link
  | "unresolved" // a citation key is present but does not match any saved source
  | "not_applicable"; // this claim type does not require evidence at all

export interface CitationVerificationResult {
  state: CitationVerificationState;
  /** Citation keys found in the claim's own text, resolved or not. */
  mentionedKeys: string[];
  /** The subset of mentionedKeys that resolve to a stored citation for this project. */
  resolvedCitationIds: string[];
  explanation: string;
}

/**
 * `research_claim_evidence.support` values gathered for one claim, restricted
 * to links whose evidence traces back to a citation this claim's own text
 * actually mentions (or, if the text mentions none, every link the claim
 * has — a claim may be linked to evidence by a researcher before the prose
 * itself carries a bracket citation).
 */
function supportsFor(
  claimId: string,
  mentionedCitationIds: Set<string>,
  claimEvidence: ResearchClaimEvidenceRow[],
  evidenceById: Map<string, ResearchEvidenceRow>,
): SupportLabel[] {
  const links = claimEvidence.filter((ce) => ce.claim_id === claimId);
  const scoped =
    mentionedCitationIds.size === 0
      ? links
      : links.filter((ce) => {
          const evidence = evidenceById.get(ce.evidence_id);
          return evidence ? mentionedCitationIds.has(evidence.citation_id) : false;
        });
  // Falling back to every link when none matches the mentioned keys keeps a
  // claim that cites [smith2024] in prose but was actually linked to
  // [smith2025]'s evidence from reporting "missing" when it plainly has
  // evidence attached — that mismatch is exactly what `partial`/`unsupported`
  // should surface, not a false "missing".
  const effective = scoped.length > 0 ? scoped : links;
  return effective.map((ce) => ce.support);
}

/**
 * Deterministic citation verification for one claim. No model is consulted.
 *
 * Walks the same decision tree §8 of the Phase 19 spec lays out: does a
 * citation key exist in the claim's own text, does it resolve to a stored
 * source in this project, does linked evidence exist, does that evidence
 * support the claim.
 */
export function verifyClaimCitation(
  claim: Pick<ResearchClaimRow, "id" | "claim_text" | "claim_type">,
  citations: Pick<ResearchCitationRow, "id" | "citation_key">[],
  evidence: Pick<ResearchEvidenceRow, "id" | "citation_id">[],
  claimEvidence: Pick<ResearchClaimEvidenceRow, "claim_id" | "evidence_id" | "support">[],
): CitationVerificationResult {
  if (!claimNeedsEvidence(claim.claim_type)) {
    return {
      state: "not_applicable",
      mentionedKeys: [],
      resolvedCitationIds: [],
      explanation: `Claims of type "${claim.claim_type}" do not require evidence.`,
    };
  }

  const mentionedKeys = extractCitationKeys(claim.claim_text);
  const citationByKey = new Map(citations.map((c) => [c.citation_key, c.id]));
  const resolvedCitationIds = mentionedKeys
    .map((key) => citationByKey.get(key))
    .filter((id): id is string => Boolean(id));

  const evidenceById = new Map(evidence.map((e) => [e.id, e as ResearchEvidenceRow]));
  const links = (claimEvidence as ResearchClaimEvidenceRow[]).filter((ce) => ce.claim_id === claim.id);

  if (mentionedKeys.length === 0 && links.length === 0) {
    return {
      state: "missing",
      mentionedKeys: [],
      resolvedCitationIds: [],
      explanation: "This claim requires evidence but names no citation and has no linked evidence.",
    };
  }

  if (mentionedKeys.length > 0 && resolvedCitationIds.length === 0 && links.length === 0) {
    return {
      state: "unresolved",
      mentionedKeys,
      resolvedCitationIds: [],
      explanation: `Cites ${mentionedKeys.map((k) => `"${k}"`).join(", ")}, which does not match any saved source for this project.`,
    };
  }

  const supports = supportsFor(claim.id, new Set(resolvedCitationIds), claimEvidence as ResearchClaimEvidenceRow[], evidenceById);

  if (supports.length === 0) {
    return {
      state: "unsupported",
      mentionedKeys,
      resolvedCitationIds,
      explanation: "The citation resolves to a saved source, but no evidence has been linked to verify it supports this claim.",
    };
  }

  if (supports.every((s) => s === "SUPPORTED")) {
    return {
      state: "verified",
      mentionedKeys,
      resolvedCitationIds,
      explanation: `Every linked evidence excerpt (${supports.length}) supports this claim.`,
    };
  }

  if (supports.some((s) => s === "SUPPORTED" || s === "PARTIAL")) {
    return {
      state: "partial",
      mentionedKeys,
      resolvedCitationIds,
      explanation: "Linked evidence gives mixed or partial support for this claim.",
    };
  }

  return {
    state: "unsupported",
    mentionedKeys,
    resolvedCitationIds,
    explanation: "Linked evidence does not support this claim (unsupported or flagged for review).",
  };
}
