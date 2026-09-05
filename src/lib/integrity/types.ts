import type { CitationFunnel } from "./citation-funnel";
import type { CoverageBreakdown } from "../evidence/status";
import type { ResearchIntegrityDecisionRow } from "../db/types";

/**
 * The Phase 19 review contract (§15-§18). Deliberately the same shape of
 * promise Phase 18's `MethodologyMetric`/`MethodologyFinding` make: a
 * metric's `value` may be `null`, meaning "not computable", and null is
 * never rendered as zero — a project with nothing to check yet is not the
 * same as a project that failed every check.
 */
export interface IntegrityMetric {
  id: string;
  label: string;
  /** 0-1, or null when the dimension is not computable. */
  value: number | null;
  status: "ok" | "attention" | "incomplete" | "not_computable";
  /** How the number was reached, or why there isn't one. */
  reason: string;
  /** The counts behind the ratio, so nothing downstream has to recompute one. */
  evidence?: { covered: number; total: number };
}

export type IntegrityFindingCategory =
  | "citation" | "evidence" | "source" | "reference" | "methodology" | "numerical" | "provenance";

export type IntegrityFindingSeverity = "info" | "warning" | "error";

/**
 * `"deterministic"` is a fact about the stored model; `"ai_suggested"` is a
 * proposal. The UI must never render the two identically (§1.3/§20), and
 * nothing in this codebase upgrades an `ai_suggested` finding to
 * `"deterministic"` after the fact.
 */
export type IntegrityFindingProvenance = "deterministic" | "ai_suggested";

/**
 * §17's stable finding shape. `id` is a computed string
 * (`` `${category}:${subcheck}:${targetId}` ``), never a database row — see
 * `research_integrity_decisions` for why a finding needs a *stable* id
 * despite never being stored itself.
 */
export interface IntegrityFinding {
  id: string;
  category: IntegrityFindingCategory;
  severity: IntegrityFindingSeverity;
  title: string;
  explanation: string;
  targetType: string;
  targetId: string;
  provenance: IntegrityFindingProvenance;
  /** What to do next, phrased as a next step rather than a verdict. */
  remediation?: string;
}

/** The completeness funnel plus evidence-coverage, gathered for the Overview tab (§9/§24). */
export interface IntegrityCoverage {
  citation: CitationFunnel;
  evidence: CoverageBreakdown;
}

/**
 * §15's canonical review: always derived, never the stored source of truth.
 * `decisions` is the one piece of real state — a researcher's disposition of
 * a finding, keyed on that finding's own stable id (§26).
 */
export interface ResearchIntegrityReview {
  projectId: string;
  metrics: IntegrityMetric[];
  findings: IntegrityFinding[];
  coverage: IntegrityCoverage;
  decisions: Record<string, ResearchIntegrityDecisionRow>;
  generatedAt: string;
}
