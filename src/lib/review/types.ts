/**
 * The Phase 20 cross-system review contract (§21–§23).
 *
 * Deliberately the same shape of promise Phase 18's `MethodologyMetric` and
 * Phase 19's `IntegrityMetric` already make: a metric's `value` may be
 * `null`, meaning "not computable", and null is never rendered as zero. A
 * project with no framework yet has no framework coverage to report —
 * showing 0% would read as a failing study rather than an empty model.
 *
 * This is a third view over the same rows, not a third source of truth.
 * Nothing here is stored: §21 requires the review to be recomputed from
 * current records on every call, for the reason Phase 17B established and
 * every phase since has kept — a stored finding is a second source of truth
 * that goes stale the moment a claim is reclassified or a construct renamed.
 */

/** §22's categories. One per actionable area, not one per check. */
export type ReviewCategory =
  | "traceability"
  | "evidence"
  | "citations"
  | "literature"
  | "methodology"
  | "framework"
  | "questionnaire"
  | "analysis"
  | "provenance";

export const REVIEW_CATEGORY_LABELS: Record<ReviewCategory, string> = {
  traceability: "Traceability",
  evidence: "Evidence",
  citations: "Citations",
  literature: "Literature",
  methodology: "Methodology",
  framework: "Framework",
  questionnaire: "Questionnaire",
  analysis: "Analysis",
  provenance: "Provenance",
};

/**
 * §23's severity rules.
 *
 * `error` is a deterministic structural failure — an edge that is broken as a
 * matter of stored fact. `warning` is a possible inconsistency or an
 * unsupported interpretation. `info` is a review opportunity.
 *
 * An `ai_suggested` finding is never emitted as `error`, and nothing in this
 * codebase promotes one to `deterministic` after the fact. That rule is
 * asserted in the tests rather than merely written down here.
 */
export type ReviewSeverity = "error" | "warning" | "info";

/**
 * `"deterministic"` is a fact about the stored model; `"ai_suggested"` is a
 * proposal. The UI must never render the two identically (§23/§11).
 */
export type ReviewProvenance = "deterministic" | "ai_suggested";

/**
 * The kinds of thing a finding can point at. Every one of these is a
 * canonical row in an existing table — a finding never targets an object
 * this phase invented.
 */
export type ReviewTargetType =
  | "claim"
  | "citation"
  | "evidence"
  | "source"
  | "construct"
  | "indicator"
  | "hypothesis"
  | "questionnaire_item"
  | "framework_node"
  | "framework_relationship"
  | "research_question"
  | "objective"
  | "analysis"
  | "section"
  | "project";

/**
 * §20 requires every finding to identify the exact broken edge, not just the
 * area. `target` is the thing to open; `relatedTo` is the other end of the
 * edge when the finding is about a relationship between two objects — so
 * "this construct is in the framework but no questionnaire item measures it"
 * can name both without inventing a joined pseudo-object.
 */
export interface ReviewFinding {
  /** Stable and computed, never a stored row — the same discipline as
   *  `IntegrityFinding.id`, so a researcher's decision can be keyed on it. */
  id: string;
  category: ReviewCategory;
  severity: ReviewSeverity;
  title: string;
  explanation: string;
  targetType: ReviewTargetType;
  targetId: string;
  relatedTo?: { type: ReviewTargetType; id: string };
  provenance: ReviewProvenance;
  /** What to do next, phrased as a next step rather than a verdict. */
  remediation?: string;
}

export interface ReviewMetric {
  id: string;
  label: string;
  category: ReviewCategory;
  /** 0-1, or null when the dimension is not computable. */
  value: number | null;
  status: "ok" | "attention" | "incomplete" | "not_computable";
  /** How the number was reached, or why there isn't one. §44 requires every
   *  metric to say what is missing rather than show a bare score. */
  reason: string;
  evidence?: { covered: number; total: number };
}

/** §21's canonical structure. */
export interface ResearchSystemReview {
  projectId: string;
  metrics: ReviewMetric[];
  findings: ReviewFinding[];
  generatedAt: string;
}

/**
 * The shared ratio helper. Returns `not_computable` for an empty denominator
 * rather than 1 or 0: "no constructs, therefore perfect coverage" and "no
 * constructs, therefore zero coverage" are both lies about an empty project.
 */
export function ratioMetric(
  covered: number,
  total: number,
  spec: { id: string; label: string; category: ReviewCategory; ok: string; empty: string },
): ReviewMetric {
  if (total === 0) {
    return {
      id: spec.id,
      label: spec.label,
      category: spec.category,
      value: null,
      status: "not_computable",
      reason: spec.empty,
    };
  }
  const value = covered / total;
  return {
    id: spec.id,
    label: spec.label,
    category: spec.category,
    value,
    status: value === 1 ? "ok" : value >= 0.5 ? "attention" : "incomplete",
    reason: spec.ok,
    evidence: { covered, total },
  };
}

const SEVERITY_ORDER: Record<ReviewSeverity, number> = { error: 0, warning: 1, info: 2 };

/** Most severe first, then stable by id so two runs over unchanged rows
 *  produce byte-identical output — which is what lets a test assert on a
 *  whole review rather than on a set. */
export function sortFindings(findings: ReviewFinding[]): ReviewFinding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id),
  );
}
