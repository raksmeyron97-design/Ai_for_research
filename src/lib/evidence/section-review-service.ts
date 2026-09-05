import type { SupabaseClient } from "@supabase/supabase-js";
import { listClaims } from "../db/evidence";
import { getSection, getSectionsByTypes } from "../db/sections";
import { extractCitationKeys } from "../ai/integrity-guard";
import { getContextPolicy } from "../ai/sections/context-policy";
import type { SectionType } from "../db/types";
import { reviewSection, type FindingSeverity } from "./section-review";
import type { CoverageBreakdown } from "./status";

/**
 * The one place a section review is assembled (§4).
 *
 * `reviewSection` is pure and takes pre-gathered inputs; before this, nothing
 * gathered them. The alternative shape — the panel fetching claims, then
 * sections, then citations, then scoring in the browser — puts the scoring
 * rules on the client where they can drift from the tests, and turns one
 * review into four round trips. So the client gets one normalized response and
 * renders it.
 *
 * What it deliberately does *not* fetch (§5): the project's other sections'
 * text, the full source library, any dataset, any evidence row. The review
 * needs this section, this section's claims, the presence of the specific
 * prior sections its policy names, and the citation keys that actually appear
 * in this section's text.
 */
export interface ReviewMetric {
  /** 0-1, or null when the dimension is not computable — never a stand-in number. */
  value: number | null;
  label: string;
  /** How the number was reached, shown beside it. */
  explanation: string;
}

export interface ReviewIssue {
  severity: FindingSeverity;
  /** The claim this concerns, when it concerns one. */
  claim?: string;
  claimId?: string;
  reason: string;
  recommendation: string;
  action: "find_evidence" | "verify_citation" | "write_content" | "review_alignment" | "none";
  /** The unresolved citation key, for a citation issue — so the UI can act on it. */
  citationKey?: string;
}

export interface SectionReview {
  /** The `research_sections` row id, or null when the section has never been saved. */
  sectionId: string | null;
  sectionType: SectionType;

  completeness: ReviewMetric;
  evidenceCoverage: ReviewMetric;
  alignment: ReviewMetric;
  citationIntegrity: ReviewMetric;

  issues: ReviewIssue[];

  /** The counts behind the coverage number, so the UI never has to recompute one. */
  coverage: CoverageBreakdown;
  checkedAt: string;
}

/** Keys in the section text that resolve to a saved source, and those that do not. */
async function splitCitationKeys(
  supabase: SupabaseClient,
  projectId: string,
  content: string,
): Promise<{ resolved: string[]; unresolved: string[] }> {
  const keys = extractCitationKeys(content);
  if (keys.length === 0) return { resolved: [], unresolved: [] };

  // Only the keys this section actually mentions — not the library.
  const { data, error } = await supabase
    .from("research_citations")
    .select("citation_key")
    .eq("project_id", projectId)
    .in("citation_key", keys);

  if (error) {
    // A failed lookup must not become "every citation is broken". Reporting
    // them all as resolved would be the opposite lie, so integrity simply
    // reports nothing measurable this run.
    return { resolved: [], unresolved: [] };
  }

  const found = new Set((data as { citation_key: string }[]).map((c) => c.citation_key));
  return {
    resolved: keys.filter((k) => found.has(k)),
    unresolved: keys.filter((k) => !found.has(k)),
  };
}

export async function buildSectionReview(
  supabase: SupabaseClient,
  projectId: string,
  sectionType: SectionType,
): Promise<SectionReview> {
  const policy = getContextPolicy(sectionType);

  const [sectionRow, claims, priorRows] = await Promise.all([
    getSection(supabase, projectId, sectionType),
    listClaims(supabase, projectId, sectionType),
    getSectionsByTypes(supabase, projectId, policy.priorSections),
  ]);

  const { resolved, unresolved } = await splitCitationKeys(
    supabase,
    projectId,
    sectionRow?.content ?? "",
  );

  const presentPriorSections = priorRows
    .filter((s) => s.content?.trim())
    .map((s) => s.section_type);

  const health = reviewSection({
    section: sectionType,
    sectionRow: sectionRow ?? undefined,
    claims,
    presentPriorSections,
    resolvedCitationKeys: resolved,
    unresolvedCitationKeys: unresolved,
  });

  // Findings carry the claim text; the id is what the UI needs to start an
  // evidence search, so it is matched back on here rather than changing the
  // pure scorer's shape.
  const claimIdByText = new Map(claims.map((c) => [c.claim_text, c.id]));
  const unresolvedSet = new Set(unresolved);

  const issues: ReviewIssue[] = health.findings.map((f) => ({
    severity: f.severity,
    claim: f.claim,
    claimId: f.claim ? claimIdByText.get(f.claim) : undefined,
    reason: f.reason,
    recommendation: f.recommendation,
    action: f.action,
    citationKey:
      f.action === "verify_citation"
        ? [...unresolvedSet].find((k) => f.reason.includes(`"${k}"`))
        : undefined,
  }));

  return {
    sectionId: sectionRow?.id ?? null,
    sectionType,
    completeness: {
      value: health.completeness,
      label: "Completeness",
      explanation: health.explanations.completeness,
    },
    evidenceCoverage: {
      value: health.evidenceCoverage,
      label: "Evidence coverage",
      explanation: health.explanations.evidenceCoverage,
    },
    alignment: {
      value: health.researchAlignment,
      label: "Research alignment",
      explanation: health.explanations.researchAlignment,
    },
    citationIntegrity: {
      value: health.citationIntegrity,
      label: "Citation integrity",
      explanation: health.explanations.citationIntegrity,
    },
    issues,
    coverage: health.coverage,
    checkedAt: new Date().toISOString(),
  };
}
