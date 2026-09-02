import { claimNeedsEvidence } from "../evidence/status";
import type { EvidenceStatusLabel, ResearchClaimRow, SectionType } from "../db/types";
import type { IntegrityFinding } from "./types";

/**
 * A claim's own `evidence_status` counts as unsupported for the scan when
 * it is one that means "nothing has verified this yet" — never a status a
 * claim's own type assigns it on purpose (USER_PROVIDED, INFERENCE), which
 * `claimNeedsEvidence` already excludes at the type level, and never
 * PARTIALLY_SUPPORTED, which is a real (if incomplete) support judgement,
 * not an absence of one.
 */
const UNSUPPORTED_STATUSES: EvidenceStatusLabel[] = ["UNSUPPORTED", "NEEDS_VERIFICATION"];

/**
 * Manuscript-wide unsupported-claim detection (§14).
 *
 * Filters strictly through `claimNeedsEvidence` — the same allowlist
 * (`factual`/`statistical`/`clinical`/`comparative`) every other coverage
 * calculation in the app already uses. This is not a sentence-level
 * uncited-text scanner: it only ever looks at rows the existing claim
 * pipeline has already classified, so an `interpretive`, `user_provided` or
 * `inference` claim can never appear here, no matter how it reads.
 */
export function scanUnsupportedClaims(
  claims: Pick<ResearchClaimRow, "id" | "claim_type" | "evidence_status" | "section_type" | "claim_text">[],
  options: { sectionType?: SectionType } = {},
): IntegrityFinding[] {
  const scoped = options.sectionType
    ? claims.filter((c) => c.section_type === options.sectionType)
    : claims;

  return scoped
    .filter((c) => claimNeedsEvidence(c.claim_type) && UNSUPPORTED_STATUSES.includes(c.evidence_status))
    .map((c) => ({
      id: `citation:unsupported-claim:${c.id}`,
      category: "citation" as const,
      severity: c.evidence_status === "UNSUPPORTED" ? ("warning" as const) : ("info" as const),
      title: "Potentially unsupported claim",
      explanation:
        c.evidence_status === "UNSUPPORTED"
          ? `This ${c.claim_type} claim has evidence linked, but none of it supports the claim as written.`
          : `This ${c.claim_type} claim requires evidence but has none linked yet.`,
      targetType: "claim",
      targetId: c.id,
      provenance: "deterministic" as const,
      remediation: "Find or link evidence for this claim, or reclassify it if it does not require evidence.",
    }));
}
