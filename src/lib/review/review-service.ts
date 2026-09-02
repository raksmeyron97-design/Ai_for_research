import type { SupabaseClient } from "@supabase/supabase-js";
import { listFrameworkNodes, listFrameworkRelationships } from "../db/framework";
import type { FrameworkModel } from "../framework/model";
import { runFrameworkChecks } from "../framework/validation";
import {
  buildIntegrityFindings,
  buildIntegrityMetrics,
  loadIntegrityModel,
} from "../integrity/review-service";
import { runConsistencyChecks } from "../methodology/consistency";
import { loadMethodologyModel } from "../methodology/review-service";
import { fromIntegrityFinding, fromMethodologyFinding } from "./adapters";
import { runCrossSystemChecks } from "./cross-system";
import type { ResearchSystemReview, ReviewCategory, ReviewFinding, ReviewMetric } from "./types";
import { sortFindings } from "./types";

/**
 * The one place a cross-system review is assembled (§20/§21).
 *
 * The discipline is the same one Phases 17B, 18 and 19 each arrived at, and
 * the reason it matters more here than anywhere else: this is the only view
 * that spans every subsystem, so it is the one most tempting to cache. It is
 * not cached. §32 is explicit that correctness beats hit rate for derived
 * findings, and a stale cross-system finding is worse than a slow one — it
 * tells a researcher their study is consistent after they have just broken it.
 *
 * Nothing here re-implements a check. Phase 18's engine and Phase 19's review
 * are called, and their findings are re-labelled by `adapters.ts`. Only two
 * things are computed here that neither of them can see: the framework checks
 * (Phase 20's own tables) and `cross-system.ts`'s edges between subsystems.
 */

export async function loadFrameworkModel(
  supabase: SupabaseClient,
  projectId: string,
  methodology: Awaited<ReturnType<typeof loadMethodologyModel>>,
): Promise<FrameworkModel> {
  const [nodes, relationships] = await Promise.all([
    listFrameworkNodes(supabase, projectId),
    listFrameworkRelationships(supabase, projectId),
  ]);

  return { nodes, relationships, methodology };
}

/**
 * Metrics are ordered by category rather than by the engine that produced
 * them, so the workspace shows "everything about evidence" together instead
 * of "everything Phase 19 happened to compute" (§44).
 */
const CATEGORY_ORDER: ReviewCategory[] = [
  "traceability",
  "evidence",
  "citations",
  "literature",
  "methodology",
  "framework",
  "questionnaire",
  "analysis",
  "provenance",
];

function sortMetrics(metrics: ReviewMetric[]): ReviewMetric[] {
  return [...metrics].sort(
    (a, b) =>
      CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
      a.id.localeCompare(b.id),
  );
}

export async function buildResearchSystemReview(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchSystemReview> {
  // The methodology model is loaded once and handed to both the framework
  // checks and Phase 18's engine. Letting each load its own would be the
  // simpler code and would double every methodology query for one review —
  // the N+1 §31 asks to be found before it ships rather than after.
  const methodology = await loadMethodologyModel(supabase, projectId);

  const [framework, integrityModel] = await Promise.all([
    loadFrameworkModel(supabase, projectId, methodology),
    loadIntegrityModel(supabase, projectId),
  ]);

  const methodologyResult = runConsistencyChecks(methodology);
  const frameworkResult = runFrameworkChecks(framework);
  const integrityFindings = buildIntegrityFindings(integrityModel, methodology);
  const integrityMetrics = buildIntegrityMetrics(integrityModel, integrityFindings);
  const crossSystem = runCrossSystemChecks({
    claims: integrityModel.claims,
    evidence: integrityModel.evidence,
    claimEvidence: integrityModel.claimEvidence,
    methodologyLinks: integrityModel.methodologyLinks,
    methodology,
  });

  const findings: ReviewFinding[] = [
    ...methodologyResult.findings.map(fromMethodologyFinding),
    ...integrityFindings.map(fromIntegrityFinding),
    ...frameworkResult.findings,
    ...crossSystem.findings,
  ];

  const metrics: ReviewMetric[] = [
    ...integrityMetrics.map((m) => ({
      ...m,
      id: `integrity_${m.id}`,
      category: INTEGRITY_METRIC_CATEGORY[m.id] ?? ("traceability" as ReviewCategory),
    })),
    ...methodologyResult.metrics.map((m) => ({
      ...m,
      id: `methodology_${m.id}`,
      category: METHODOLOGY_METRIC_CATEGORY[m.id] ?? ("methodology" as ReviewCategory),
    })),
    ...frameworkResult.metrics,
    ...crossSystem.metrics,
  ];

  return {
    projectId,
    metrics: sortMetrics(metrics),
    findings: sortFindings(findings),
    generatedAt: new Date().toISOString(),
  };
}

const INTEGRITY_METRIC_CATEGORY: Record<string, ReviewCategory> = {
  citation_coverage: "citations",
  evidence_coverage: "evidence",
  source_resolvability: "literature",
  claim_traceability: "traceability",
  reference_integrity: "literature",
  numerical_traceability: "analysis",
  provenance_completeness: "provenance",
};

const METHODOLOGY_METRIC_CATEGORY: Record<string, ReviewCategory> = {
  question_alignment: "methodology",
  objective_coverage: "methodology",
  construct_completeness: "methodology",
  variable_traceability: "traceability",
  hypothesis_traceability: "traceability",
  measurement_coverage: "questionnaire",
  questionnaire_coverage: "questionnaire",
  analysis_coverage: "analysis",
  provenance_integrity: "provenance",
};
