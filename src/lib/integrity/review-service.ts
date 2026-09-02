import type { SupabaseClient } from "@supabase/supabase-js";
import { listCitations } from "../db/citations";
import { getDataset, listDatasets } from "../db/datasets";
import { listClaimEvidence, listClaims, listEvidence } from "../db/evidence";
import { listClaimMethodologyLinks, listIntegrityDecisions } from "../db/integrity";
import { listSections } from "../db/sections";
import { computeCoverage } from "../evidence/status";
import { loadMethodologyModel } from "../methodology/review-service";
import type { ResearchClaimMethodologyLinkRow, ResearchIntegrityDecisionRow, SectionType } from "../db/types";
import type { ParsedDataset } from "../data/parse-dataset";
import { computeCitationFunnel } from "./citation-funnel";
import { buildManuscriptConsistencyFindings } from "./manuscript-consistency";
import { traceClaimNumbers } from "./numerical-traceability";
import {
  findDuplicateReferences,
  findMalformedIdentifiers,
  findMissingBibliographyEntries,
  findMissingMetadata,
  findUnusedReferences,
} from "./reference-audit";
import { buildClaimTraceability, type ClaimTraceability } from "./traceability";
import { scanUnsupportedClaims } from "./unsupported-scan";
import type { IntegrityFinding, IntegrityMetric, ResearchIntegrityReview } from "./types";

export interface IntegrityScope {
  sectionType?: SectionType;
}

/**
 * Everything the deterministic checks reason over, gathered once. Mirrors
 * `loadMethodologyModel`'s role for Phase 18 exactly (§35): the checks
 * themselves stay pure, so every fetching decision lives here where it can
 * be reviewed in one place.
 */
export interface IntegrityModel {
  claims: Awaited<ReturnType<typeof listClaims>>;
  citations: Awaited<ReturnType<typeof listCitations>>;
  evidence: Awaited<ReturnType<typeof listEvidence>>;
  claimEvidence: Awaited<ReturnType<typeof listClaimEvidence>>;
  methodologyLinks: ResearchClaimMethodologyLinkRow[];
  sections: Awaited<ReturnType<typeof listSections>>;
  datasets: ParsedDataset[];
}

export async function loadIntegrityModel(
  supabase: SupabaseClient,
  projectId: string,
  scope: IntegrityScope = {},
): Promise<IntegrityModel> {
  const [claims, citations, evidence, claimEvidence, methodologyLinks, sections, datasetSummaries] =
    await Promise.all([
      listClaims(supabase, projectId, scope.sectionType),
      listCitations(supabase, projectId),
      listEvidence(supabase, projectId),
      listClaimEvidence(supabase, projectId),
      listClaimMethodologyLinks(supabase, projectId),
      listSections(supabase, projectId),
      listDatasets(supabase, projectId),
    ]);

  // Numeric traceability needs actual rows, not just metadata — loaded only
  // for the datasets that exist, and only their own full row, never the
  // whole project's other tables (§37).
  const datasets = (
    await Promise.all(datasetSummaries.map((d) => getDataset(supabase, d.id)))
  )
    .filter((d): d is NonNullable<typeof d> => d !== null)
    .map((d) => ({ columns: d.column_schema, rows: d.data }));

  return { claims, citations, evidence, claimEvidence, methodologyLinks, sections, datasets };
}

function ratio(
  covered: number,
  total: number,
  id: string,
  label: string,
  reasons: { ok: string; empty: string },
): IntegrityMetric {
  if (total === 0) {
    return { id, label, value: null, status: "not_computable", reason: reasons.empty };
  }
  const value = covered / total;
  return {
    id,
    label,
    value,
    status: value === 1 ? "ok" : value >= 0.5 ? "attention" : "incomplete",
    reason: reasons.ok,
    evidence: { covered, total },
  };
}

/**
 * `missing`/`unresolved` citation states get their own findings — distinct
 * from `scanUnsupportedClaims`, which reports the claim's own derived
 * `evidence_status`. The two can legitimately both fire for one claim: a
 * claim can name an invented citation key (`unresolved`) while its
 * `evidence_status` is still `NEEDS_VERIFICATION` — different facts, worth
 * saying separately rather than collapsed into one "citation is wrong".
 */
function citationStateFindings(traceability: ClaimTraceability[]): IntegrityFinding[] {
  return traceability
    .filter((t) => t.citation.state === "missing" || t.citation.state === "unresolved")
    .map((t) => ({
      id: `citation:${t.citation.state}-citation:${t.claimId}`,
      category: "citation" as const,
      severity: t.citation.state === "unresolved" ? ("warning" as const) : ("info" as const),
      title: t.citation.state === "unresolved" ? "Citation present but does not resolve" : "No citation present",
      explanation: t.citation.explanation,
      targetType: "claim",
      targetId: t.claimId,
      provenance: "deterministic" as const,
      remediation:
        t.citation.state === "unresolved"
          ? "Add this source to the project's references, or correct the citation key."
          : "Add a citation for this claim, or reclassify it if it does not require evidence.",
    }));
}

/**
 * Exported so Phase 20's cross-system review can reuse Phase 19's rules
 * without re-running its queries. The alternative — calling
 * `buildResearchIntegrityReview` from there — would load the methodology
 * model a second time for one review, which is exactly the N+1 §31 asks to be
 * found before it ships.
 */
export function buildIntegrityFindings(model: IntegrityModel, methodologyModel: Awaited<ReturnType<typeof loadMethodologyModel>>): IntegrityFinding[] {
  const traceability = buildClaimTraceability(
    model.claims,
    model.citations,
    model.evidence,
    model.claimEvidence,
    model.methodologyLinks,
  );

  const numericalFindings = model.claims.flatMap((claim) =>
    traceClaimNumbers(claim, model.datasets)
      .filter((t) => t.state === "inconsistent")
      .map((t) => ({
        id: `numerical:${t.state}:${claim.id}:${t.mention.statistic}`,
        category: "numerical" as const,
        severity: "warning" as const,
        title: "Numeric claim does not match computed data",
        explanation: t.explanation,
        targetType: "claim",
        targetId: claim.id,
        provenance: "deterministic" as const,
        remediation: "Check the reported value against the linked dataset, or correct the claim.",
      })),
  );

  const findings = [
    ...scanUnsupportedClaims(model.claims),
    ...citationStateFindings(traceability),
    ...numericalFindings,
    ...buildManuscriptConsistencyFindings(model.claims, methodologyModel, model.methodologyLinks),
    ...findMissingBibliographyEntries(model.sections, model.citations),
    ...findUnusedReferences(model.sections, model.citations, model.evidence),
    ...findDuplicateReferences(model.citations),
    ...findMalformedIdentifiers(model.citations),
    ...findMissingMetadata(model.citations),
  ];

  const severityOrder = { error: 0, warning: 1, info: 2 } as const;
  return findings.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
}

export function buildIntegrityMetrics(model: IntegrityModel, findings: IntegrityFinding[]): IntegrityMetric[] {
  const funnel = computeCitationFunnel(model.claims, model.claimEvidence, model.evidence, model.citations);
  const evidenceCoverage = computeCoverage(model.claims);

  const traceability = buildClaimTraceability(
    model.claims,
    model.citations,
    model.evidence,
    model.claimEvidence,
    model.methodologyLinks,
  );
  const verifiedCount = traceability.filter((t) => t.citation.state === "verified").length;

  const referenceIssueIds = new Set(
    findings
      .filter((f) => f.category === "reference" && f.severity !== "info")
      .map((f) => f.targetId),
  );
  const cleanReferences = model.citations.filter((c) => !referenceIssueIds.has(c.id)).length;

  const provenanceComplete = model.citations.filter((c) => c.status !== "unverified").length;

  const numericMentions = model.claims.flatMap((c) => traceClaimNumbers(c, model.datasets));
  const eligibleMentions = numericMentions.filter((m) => m.state !== "not_computable");
  const traceableMentions = eligibleMentions.filter((m) => m.state === "traceable");

  return [
    ratio(funnel.cited, funnel.requiringEvidence, "citation_coverage", "Citation coverage", {
      ok: "Claims requiring evidence that name a citation, resolved or not.",
      empty: "No claims in this project require evidence yet.",
    }),
    {
      id: "evidence_coverage",
      label: "Evidence coverage",
      value: evidenceCoverage.coverage,
      status:
        evidenceCoverage.coverage === null
          ? "not_computable"
          : evidenceCoverage.coverage === 1
            ? "ok"
            : evidenceCoverage.coverage >= 0.5
              ? "attention"
              : "incomplete",
      reason: evidenceCoverage.explanation,
      evidence:
        evidenceCoverage.requiring > 0
          ? { covered: evidenceCoverage.supported + evidenceCoverage.partiallySupported * 0.5, total: evidenceCoverage.requiring }
          : undefined,
    },
    ratio(funnel.linkedToResolvableSource, funnel.requiringEvidence, "source_resolvability", "Source resolvability", {
      ok: "Claims requiring evidence whose linked evidence resolves to a saved, project-scoped source.",
      empty: "No claims in this project require evidence yet.",
    }),
    ratio(verifiedCount, funnel.requiringEvidence, "claim_traceability", "Claim traceability", {
      ok: "Claims requiring evidence whose citation is fully verified (resolved, linked, and supported).",
      empty: "No claims in this project require evidence yet.",
    }),
    ratio(cleanReferences, model.citations.length, "reference_integrity", "Reference integrity", {
      ok: "Saved references with no unresolved warning- or error-level reference finding.",
      empty: "No references have been saved yet.",
    }),
    ratio(traceableMentions.length, eligibleMentions.length, "numerical_traceability", "Numerical traceability", {
      ok: "Numeric mentions that were checked against a linked dataset and match.",
      empty: "No numeric claims could be checked against a linked dataset yet.",
    }),
    ratio(provenanceComplete, model.citations.length, "provenance_completeness", "Provenance completeness", {
      ok: "References with a resolved provenance status (not left as unverified).",
      empty: "No references have been saved yet.",
    }),
  ];
}

/**
 * The one place a research integrity review is assembled (§35's discipline,
 * carried over from Phase 18). Nothing here is persisted — every finding and
 * metric is recomputed from stored rows on every call, for the same reason
 * `SectionReview` and `MethodologyReview` already work this way: a stored
 * finding is a second source of truth that goes stale the moment a claim is
 * reclassified or evidence is linked.
 */
export async function buildResearchIntegrityReview(
  supabase: SupabaseClient,
  projectId: string,
  scope: IntegrityScope = {},
): Promise<ResearchIntegrityReview> {
  const [model, methodologyModel, decisionRows] = await Promise.all([
    loadIntegrityModel(supabase, projectId, scope),
    loadMethodologyModel(supabase, projectId),
    listIntegrityDecisions(supabase, projectId),
  ]);

  const findings = buildIntegrityFindings(model, methodologyModel);
  const metrics = buildIntegrityMetrics(model, findings);
  const funnel = computeCitationFunnel(model.claims, model.claimEvidence, model.evidence, model.citations);

  const decisions: Record<string, ResearchIntegrityDecisionRow> = {};
  for (const decision of decisionRows) decisions[decision.finding_id] = decision;

  return {
    projectId,
    metrics,
    findings,
    coverage: {
      citation: funnel,
      evidence: computeCoverage(model.claims),
    },
    decisions,
    generatedAt: new Date().toISOString(),
  };
}
