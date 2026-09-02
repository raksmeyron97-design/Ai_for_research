import type {
  ResearchCitationRow,
  ResearchClaimEvidenceRow,
  ResearchEvidenceRow,
  SupportLabel,
} from "../db/types";

/**
 * One source's stance on one claim, as recorded — not interpreted. §7/§13/§26
 * are explicit that this view exists to let a researcher see disagreement,
 * not to resolve it: there is deliberately no aggregate or consensus score
 * here. A SUPPORTED next to a CONTRADICTS-shaded UNSUPPORTED for the same
 * claim already downgrades that claim's derived status via
 * `deriveClaimStatus` — this module's only job is to surface the *why*,
 * per source.
 */
export interface SourceConflictEntry {
  citationId: string;
  citationKey: string;
  evidenceId: string;
  support: SupportLabel;
  excerpt: string;
  note: string | null;
}

export interface SourceConflictView {
  claimId: string;
  entries: SourceConflictEntry[];
  /**
   * True only when the linked sources disagree with each other — at least
   * two distinct support labels among the entries. A claim with three
   * SUPPORTED sources is not a conflict; one SUPPORTED and one UNSUPPORTED
   * is.
   */
  hasConflict: boolean;
}

export function buildSourceConflicts(
  claimId: string,
  claimEvidence: Pick<ResearchClaimEvidenceRow, "claim_id" | "evidence_id" | "support" | "note">[],
  evidence: Pick<ResearchEvidenceRow, "id" | "citation_id" | "excerpt">[],
  citations: Pick<ResearchCitationRow, "id" | "citation_key">[],
): SourceConflictView {
  const evidenceById = new Map(evidence.map((e) => [e.id, e]));
  const citationById = new Map(citations.map((c) => [c.id, c]));

  const entries: SourceConflictEntry[] = claimEvidence
    .filter((ce) => ce.claim_id === claimId)
    .map((ce) => {
      const ev = evidenceById.get(ce.evidence_id);
      const citation = ev ? citationById.get(ev.citation_id) : undefined;
      if (!ev || !citation) return null;
      return {
        citationId: citation.id,
        citationKey: citation.citation_key,
        evidenceId: ev.id,
        support: ce.support,
        excerpt: ev.excerpt,
        note: ce.note ?? null,
      };
    })
    .filter((e): e is SourceConflictEntry => e !== null);

  const distinctSupports = new Set(entries.map((e) => e.support));

  return {
    claimId,
    entries,
    hasConflict: distinctSupports.size > 1,
  };
}
