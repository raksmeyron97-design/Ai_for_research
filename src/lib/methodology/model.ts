import type {
  QuestionnaireQuestionRow,
  ResearchConstructRow,
  ResearchHypothesisRow,
  ResearchHypothesisVariableRow,
  ResearchIndicatorRow,
  ResearchObjectiveRow,
  ResearchQuestionRow,
  ResearchScaleRow,
} from "../db/types";

/**
 * Everything the deterministic engine reasons over, gathered once.
 *
 * The engine is pure: it takes this and returns findings. Nothing in
 * `graph.ts`, `coverage.ts` or `consistency.ts` touches the database, which is
 * what makes every rule testable without a fixture server and keeps the
 * fetching decisions (§35) in one reviewable place — `review-service.ts`.
 */
export interface MethodologyModel {
  questions: ResearchQuestionRow[];
  objectives: ResearchObjectiveRow[];
  constructs: ResearchConstructRow[];
  indicators: ResearchIndicatorRow[];
  hypotheses: ResearchHypothesisRow[];
  hypothesisVariables: ResearchHypothesisVariableRow[];
  scales: ResearchScaleRow[];
  items: QuestionnaireQuestionRow[];
  /** The prose analysis plan, when the project has written one. */
  analysisPlan?: string | null;
}

export const EMPTY_MODEL: MethodologyModel = {
  questions: [],
  objectives: [],
  constructs: [],
  indicators: [],
  hypotheses: [],
  hypothesisVariables: [],
  scales: [],
  items: [],
  analysisPlan: null,
};

export function byId<T extends { id: string }>(rows: T[]): Map<string, T> {
  return new Map(rows.map((row) => [row.id, row]));
}
