import type {
  ConstructRole,
  HypothesisPosition,
  MethodologyProvenance,
  QuestionKind,
} from "../db/types";

/**
 * The Phase 18 review contract (§15).
 *
 * Deliberately the same shape of promise Phase 17B's `SectionReview` makes: a
 * metric's `value` may be `null`, meaning "not computable", and null is never
 * rendered as zero. A project with no constructs has no measurement coverage to
 * report — showing 0% would read as a failing study rather than an empty model.
 */
export interface MethodologyMetric {
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

export type FindingSeverity = "info" | "warning" | "error";

/**
 * Where a finding came from. This is the field that keeps the system honest:
 * a deterministic finding is a fact about the stored model, an `ai_suggested`
 * one is a proposal, and the UI must never render them identically (§1.3).
 */
export type FindingProvenance = MethodologyProvenance | "deterministic";

export type MethodologyEntityKind =
  | "research_question" | "objective" | "construct" | "indicator"
  | "hypothesis" | "questionnaire_item" | "scale" | "analysis_plan" | "project";

export interface MethodologyFinding {
  id: string;
  category: string;
  severity: FindingSeverity;
  title: string;
  explanation: string;
  /** The text the finding rests on — the item wording, the statement, the name. */
  evidence?: string;
  provenance: FindingProvenance;
  targetType: MethodologyEntityKind;
  targetId: string;
  /** What to do next, phrased as a next step rather than a verdict. */
  remediation?: string;
}

// ---------------------------------------------------------------------
// The methodology graph
//
// Built from stored rows only. An edge exists because a foreign key exists,
// never because a model said two things are related — which is what makes a
// missing edge a fact rather than an opinion.
// ---------------------------------------------------------------------
export interface MethodologyNode {
  id: string;
  kind: MethodologyEntityKind;
  label: string;
  provenance: MethodologyProvenance;
  /** Role for a construct, position for a hypothesis link, kind for a question. */
  detail?: ConstructRole | QuestionKind | string;
}

export interface MethodologyEdge {
  from: string;
  to: string;
  kind:
    | "question_objective"
    | "objective_hypothesis"
    | "question_hypothesis"
    | "hypothesis_construct"
    | "construct_indicator"
    | "indicator_item"
    | "construct_item";
  detail?: HypothesisPosition | string;
}

export interface MethodologyGraph {
  nodes: MethodologyNode[];
  edges: MethodologyEdge[];
}

export interface MethodologyReview {
  projectId: string;
  metrics: MethodologyMetric[];
  findings: MethodologyFinding[];
  graph: MethodologyGraph;
  /** Row counts the workspace header shows, so it does not re-fetch to count. */
  totals: {
    questions: number;
    objectives: number;
    constructs: number;
    indicators: number;
    hypotheses: number;
    items: number;
  };
  generatedAt: string;
}
