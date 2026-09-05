import { extractCitationKeys } from "../ai/integrity-guard";
import { claimNeedsEvidence } from "../evidence/status";
import type {
  ResearchCitationRow,
  ResearchClaimEvidenceRow,
  ResearchClaimRow,
  ResearchEvidenceRow,
} from "../db/types";

/**
 * The completeness funnel from §9: each stage is a strict count of stored
 * rows, and each stage can only be less than or equal to the one before it.
 * "Cited" and "linked to evidence" are kept separate on purpose — a claim
 * can name a citation key in its own prose before a researcher has curated
 * evidence for it, and collapsing the two stages would hide exactly that
 * gap.
 */
export interface CitationFunnel {
  requiringEvidence: number;
  cited: number;
  linkedToEvidence: number;
  linkedToResolvableSource: number;
}

export function computeCitationFunnel(
  claims: Pick<ResearchClaimRow, "id" | "claim_text" | "claim_type">[],
  claimEvidence: Pick<ResearchClaimEvidenceRow, "claim_id" | "evidence_id">[],
  evidence: Pick<ResearchEvidenceRow, "id" | "citation_id">[],
  citations: Pick<ResearchCitationRow, "id">[],
): CitationFunnel {
  const requiring = claims.filter((c) => claimNeedsEvidence(c.claim_type));

  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const citationIds = new Set(citations.map((c) => c.id));
  const linksByClaim = new Map<string, typeof claimEvidence>();
  for (const link of claimEvidence) {
    const list = linksByClaim.get(link.claim_id) ?? [];
    list.push(link);
    linksByClaim.set(link.claim_id, list);
  }

  let cited = 0;
  let linkedToEvidence = 0;
  let linkedToResolvableSource = 0;

  for (const claim of requiring) {
    if (extractCitationKeys(claim.claim_text).length > 0) cited += 1;

    const links = linksByClaim.get(claim.id) ?? [];
    if (links.length > 0) linkedToEvidence += 1;

    const resolvable = links.some((link) => {
      const ev = evidenceById.get(link.evidence_id);
      return ev ? citationIds.has(ev.citation_id) : false;
    });
    if (resolvable) linkedToResolvableSource += 1;
  }

  return {
    requiringEvidence: requiring.length,
    cited,
    linkedToEvidence,
    linkedToResolvableSource,
  };
}
