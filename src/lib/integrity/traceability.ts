import { verifyClaimCitation, type CitationVerificationResult } from "./citation-verification";
import type {
  ResearchCitationRow,
  ResearchClaimEvidenceRow,
  ResearchClaimMethodologyLinkRow,
  ResearchClaimRow,
  ResearchEvidenceRow,
} from "../db/types";

/**
 * One claim's full traceability picture: where its citation stands, and
 * which methodology node (if any) it has been tied to. This is the shape
 * the Claims tab renders one row from — it does not decide anything, it
 * just assembles what §24/§25 need to display together.
 */
export interface ClaimTraceability {
  claimId: string;
  citation: CitationVerificationResult;
  methodologyLinks: ResearchClaimMethodologyLinkRow[];
}

export function buildClaimTraceability(
  claims: Pick<ResearchClaimRow, "id" | "claim_text" | "claim_type">[],
  citations: Pick<ResearchCitationRow, "id" | "citation_key">[],
  evidence: Pick<ResearchEvidenceRow, "id" | "citation_id">[],
  claimEvidence: Pick<ResearchClaimEvidenceRow, "claim_id" | "evidence_id" | "support">[],
  methodologyLinks: ResearchClaimMethodologyLinkRow[],
): ClaimTraceability[] {
  const linksByClaim = new Map<string, ResearchClaimMethodologyLinkRow[]>();
  for (const link of methodologyLinks) {
    const list = linksByClaim.get(link.claim_id) ?? [];
    list.push(link);
    linksByClaim.set(link.claim_id, list);
  }

  return claims.map((claim) => ({
    claimId: claim.id,
    citation: verifyClaimCitation(claim, citations, evidence, claimEvidence),
    methodologyLinks: linksByClaim.get(claim.id) ?? [],
  }));
}
