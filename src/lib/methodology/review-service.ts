import type { SupabaseClient } from "@supabase/supabase-js";
import {
  listConstructs,
  listHypotheses,
  listHypothesisVariables,
  listIndicators,
  listObjectives,
  listResearchQuestions,
  listScales,
} from "../db/methodology";
import { listQuestionsForProject } from "../db/questions";
import { getSectionsByTypes } from "../db/sections";
import { buildGraph } from "./graph";
import { runConsistencyChecks } from "./consistency";
import type { MethodologyModel } from "./model";
import type { MethodologyReview } from "./types";

/**
 * The one place a methodology review is assembled.
 *
 * The engine itself is pure, so this is where every fetching decision lives and
 * can be reviewed in one place (§35). What it loads is the methodology model
 * and one section — not the thesis, not the source library, not the evidence
 * chain, not history. A methodology review is about the structure, and loading
 * a project's prose to reason about its structure would be paying for text
 * nothing reads.
 *
 * Nothing is persisted. Findings are derived from the rows every time, for the
 * reason Phase 17B established with `SectionReview`: a stored finding is a
 * second source of truth that goes stale the moment a construct is renamed.
 */
export async function loadMethodologyModel(
  supabase: SupabaseClient,
  projectId: string,
): Promise<MethodologyModel> {
  const [
    questions,
    objectives,
    constructs,
    indicators,
    hypotheses,
    hypothesisVariables,
    scales,
    items,
    sections,
  ] = await Promise.all([
    listResearchQuestions(supabase, projectId),
    listObjectives(supabase, projectId),
    listConstructs(supabase, projectId),
    listIndicators(supabase, projectId),
    listHypotheses(supabase, projectId),
    listHypothesisVariables(supabase, projectId),
    listScales(supabase, projectId),
    listQuestionsForProject(supabase, projectId),
    // Only the analysis plan, and only its text — the §33 checks read the
    // recorded method, not the chapter.
    getSectionsByTypes(supabase, projectId, ["data_analysis"]),
  ]);

  return {
    questions,
    objectives,
    constructs,
    indicators,
    hypotheses,
    hypothesisVariables,
    scales,
    items,
    analysisPlan: sections[0]?.content ?? null,
  };
}

export async function buildMethodologyReview(
  supabase: SupabaseClient,
  projectId: string,
): Promise<MethodologyReview> {
  const model = await loadMethodologyModel(supabase, projectId);
  const { findings, metrics } = runConsistencyChecks(model);

  return {
    projectId,
    metrics,
    findings,
    graph: buildGraph(model),
    totals: {
      questions: model.questions.length,
      objectives: model.objectives.length,
      constructs: model.constructs.length,
      indicators: model.indicators.length,
      hypotheses: model.hypotheses.length,
      items: model.items.length,
    },
    generatedAt: new Date().toISOString(),
  };
}
