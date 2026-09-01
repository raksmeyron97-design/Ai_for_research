import type { SupabaseClient } from "@supabase/supabase-js";
import { DbError, toDbError } from "./errors";
import type {
  ResearchConstructInsert,
  ResearchConstructRow,
  ResearchHypothesisInsert,
  ResearchHypothesisRow,
  ResearchHypothesisVariableInsert,
  ResearchHypothesisVariableRow,
  ResearchIndicatorInsert,
  ResearchIndicatorRow,
  ResearchObjectiveInsert,
  ResearchObjectiveRow,
  ResearchQuestionInsert,
  ResearchQuestionRow,
  ResearchScaleInsert,
  ResearchScaleRow,
} from "./types";

/**
 * The methodology chain's data access (Phase 18).
 *
 * Every function takes `projectId` and filters on it, even where the id alone
 * would be unique — the same rule the literature tables follow. An object id is
 * never sufficient authorisation on its own (§27); a query that matched on `id`
 * alone would depend entirely on a policy being right.
 *
 * Reads are scoped and field-selective by default (§35). Nothing here loads
 * "the project": the workspace asks for the list it is showing.
 */
const QUESTIONS = "research_questions";
const OBJECTIVES = "research_objectives";
const CONSTRUCTS = "research_constructs";
const INDICATORS = "research_indicators";
const HYPOTHESES = "research_hypotheses";
const HYPOTHESIS_VARIABLES = "research_hypothesis_variables";
const SCALES = "research_scales";

function stamped<T extends object>(patch: T): T & { updated_at: string } {
  return { ...patch, updated_at: new Date().toISOString() };
}

// ---------------------------------------------------------------------
// Research questions
// ---------------------------------------------------------------------
export async function listResearchQuestions(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchQuestionRow[]> {
  const { data, error } = await supabase
    .from(QUESTIONS)
    .select("*")
    .eq("project_id", projectId)
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw toDbError(error, "listResearchQuestions");
  return data as ResearchQuestionRow[];
}

export async function createResearchQuestion(
  supabase: SupabaseClient,
  input: ResearchQuestionInsert,
): Promise<ResearchQuestionRow> {
  const { data, error } = await supabase.from(QUESTIONS).insert(input).select("*").single();
  if (error) throw toDbError(error, "createResearchQuestion");
  return data as ResearchQuestionRow;
}

export async function updateResearchQuestion(
  supabase: SupabaseClient,
  projectId: string,
  questionId: string,
  patch: Partial<Pick<ResearchQuestionRow, "question_text" | "question_kind" | "confirmed" | "order_index">>,
): Promise<ResearchQuestionRow> {
  const { data, error } = await supabase
    .from(QUESTIONS)
    .update(stamped(patch))
    .eq("id", questionId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) throw toDbError(error, "updateResearchQuestion");
  if (!data) throw new DbError("updateResearchQuestion: question not found", true);
  return data as ResearchQuestionRow;
}

export async function deleteResearchQuestion(
  supabase: SupabaseClient,
  projectId: string,
  questionId: string,
): Promise<void> {
  const { error } = await supabase
    .from(QUESTIONS)
    .delete()
    .eq("id", questionId)
    .eq("project_id", projectId);
  if (error) throw toDbError(error, "deleteResearchQuestion");
}

// ---------------------------------------------------------------------
// Objectives
// ---------------------------------------------------------------------
export async function listObjectives(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchObjectiveRow[]> {
  const { data, error } = await supabase
    .from(OBJECTIVES)
    .select("*")
    .eq("project_id", projectId)
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw toDbError(error, "listObjectives");
  return data as ResearchObjectiveRow[];
}

export async function createObjective(
  supabase: SupabaseClient,
  input: ResearchObjectiveInsert,
): Promise<ResearchObjectiveRow> {
  const { data, error } = await supabase.from(OBJECTIVES).insert(input).select("*").single();
  if (error) throw toDbError(error, "createObjective");
  return data as ResearchObjectiveRow;
}

export async function updateObjective(
  supabase: SupabaseClient,
  projectId: string,
  objectiveId: string,
  patch: Partial<Pick<ResearchObjectiveRow, "objective_text" | "question_id" | "confirmed" | "order_index">>,
): Promise<ResearchObjectiveRow> {
  const { data, error } = await supabase
    .from(OBJECTIVES)
    .update(stamped(patch))
    .eq("id", objectiveId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) throw toDbError(error, "updateObjective");
  if (!data) throw new DbError("updateObjective: objective not found", true);
  return data as ResearchObjectiveRow;
}

export async function deleteObjective(
  supabase: SupabaseClient,
  projectId: string,
  objectiveId: string,
): Promise<void> {
  const { error } = await supabase
    .from(OBJECTIVES)
    .delete()
    .eq("id", objectiveId)
    .eq("project_id", projectId);
  if (error) throw toDbError(error, "deleteObjective");
}

// ---------------------------------------------------------------------
// Constructs
// ---------------------------------------------------------------------
export async function listConstructs(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchConstructRow[]> {
  const { data, error } = await supabase
    .from(CONSTRUCTS)
    .select("*")
    .eq("project_id", projectId)
    .order("name", { ascending: true });

  if (error) throw toDbError(error, "listConstructs");
  return data as ResearchConstructRow[];
}

export async function getConstruct(
  supabase: SupabaseClient,
  projectId: string,
  constructId: string,
): Promise<ResearchConstructRow | null> {
  const { data, error } = await supabase
    .from(CONSTRUCTS)
    .select("*")
    .eq("id", constructId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw toDbError(error, "getConstruct");
  return (data as ResearchConstructRow) ?? null;
}

export async function createConstruct(
  supabase: SupabaseClient,
  input: ResearchConstructInsert,
): Promise<ResearchConstructRow> {
  const { data, error } = await supabase.from(CONSTRUCTS).insert(input).select("*").single();
  if (error) throw toDbError(error, "createConstruct");
  return data as ResearchConstructRow;
}

export async function updateConstruct(
  supabase: SupabaseClient,
  projectId: string,
  constructId: string,
  patch: Partial<
    Pick<
      ResearchConstructRow,
      "name" | "role" | "conceptual_definition" | "operational_definition" | "notes" | "confirmed"
    >
  >,
): Promise<ResearchConstructRow> {
  const { data, error } = await supabase
    .from(CONSTRUCTS)
    .update(stamped(patch))
    .eq("id", constructId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) throw toDbError(error, "updateConstruct");
  if (!data) throw new DbError("updateConstruct: construct not found", true);
  return data as ResearchConstructRow;
}

export async function deleteConstruct(
  supabase: SupabaseClient,
  projectId: string,
  constructId: string,
): Promise<void> {
  const { error } = await supabase
    .from(CONSTRUCTS)
    .delete()
    .eq("id", constructId)
    .eq("project_id", projectId);
  if (error) throw toDbError(error, "deleteConstruct");
}

// ---------------------------------------------------------------------
// Indicators
// ---------------------------------------------------------------------
export async function listIndicators(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchIndicatorRow[]> {
  const { data, error } = await supabase
    .from(INDICATORS)
    .select("*")
    .eq("project_id", projectId)
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw toDbError(error, "listIndicators");
  return data as ResearchIndicatorRow[];
}

export async function createIndicator(
  supabase: SupabaseClient,
  input: ResearchIndicatorInsert,
): Promise<ResearchIndicatorRow> {
  const { data, error } = await supabase.from(INDICATORS).insert(input).select("*").single();
  if (error) throw toDbError(error, "createIndicator");
  return data as ResearchIndicatorRow;
}

export async function updateIndicator(
  supabase: SupabaseClient,
  projectId: string,
  indicatorId: string,
  patch: Partial<Pick<ResearchIndicatorRow, "name" | "dimension" | "description" | "confirmed" | "order_index">>,
): Promise<ResearchIndicatorRow> {
  const { data, error } = await supabase
    .from(INDICATORS)
    .update(stamped(patch))
    .eq("id", indicatorId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) throw toDbError(error, "updateIndicator");
  if (!data) throw new DbError("updateIndicator: indicator not found", true);
  return data as ResearchIndicatorRow;
}

export async function deleteIndicator(
  supabase: SupabaseClient,
  projectId: string,
  indicatorId: string,
): Promise<void> {
  const { error } = await supabase
    .from(INDICATORS)
    .delete()
    .eq("id", indicatorId)
    .eq("project_id", projectId);
  if (error) throw toDbError(error, "deleteIndicator");
}

// ---------------------------------------------------------------------
// Hypotheses
// ---------------------------------------------------------------------
export async function listHypotheses(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchHypothesisRow[]> {
  const { data, error } = await supabase
    .from(HYPOTHESES)
    .select("*")
    .eq("project_id", projectId)
    .order("order_index", { ascending: true })
    .order("created_at", { ascending: true });

  if (error) throw toDbError(error, "listHypotheses");
  return data as ResearchHypothesisRow[];
}

export async function createHypothesis(
  supabase: SupabaseClient,
  input: ResearchHypothesisInsert,
): Promise<ResearchHypothesisRow> {
  const { data, error } = await supabase.from(HYPOTHESES).insert(input).select("*").single();
  if (error) throw toDbError(error, "createHypothesis");
  return data as ResearchHypothesisRow;
}

export async function updateHypothesis(
  supabase: SupabaseClient,
  projectId: string,
  hypothesisId: string,
  patch: Partial<
    Pick<
      ResearchHypothesisRow,
      | "label" | "statement" | "hypothesis_form" | "direction" | "analysis_method"
      | "objective_id" | "question_id" | "confirmed" | "order_index"
    >
  >,
): Promise<ResearchHypothesisRow> {
  const { data, error } = await supabase
    .from(HYPOTHESES)
    .update(stamped(patch))
    .eq("id", hypothesisId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) throw toDbError(error, "updateHypothesis");
  if (!data) throw new DbError("updateHypothesis: hypothesis not found", true);
  return data as ResearchHypothesisRow;
}

export async function deleteHypothesis(
  supabase: SupabaseClient,
  projectId: string,
  hypothesisId: string,
): Promise<void> {
  const { error } = await supabase
    .from(HYPOTHESES)
    .delete()
    .eq("id", hypothesisId)
    .eq("project_id", projectId);
  if (error) throw toDbError(error, "deleteHypothesis");
}

// ---------------------------------------------------------------------
// Hypothesis ↔ construct links
// ---------------------------------------------------------------------
export async function listHypothesisVariables(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchHypothesisVariableRow[]> {
  const { data, error } = await supabase
    .from(HYPOTHESIS_VARIABLES)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) throw toDbError(error, "listHypothesisVariables");
  return data as ResearchHypothesisVariableRow[];
}

export async function linkHypothesisVariable(
  supabase: SupabaseClient,
  input: ResearchHypothesisVariableInsert,
): Promise<ResearchHypothesisVariableRow> {
  const { data, error } = await supabase
    .from(HYPOTHESIS_VARIABLES)
    .insert(input)
    .select("*")
    .single();

  if (error) throw toDbError(error, "linkHypothesisVariable");
  return data as ResearchHypothesisVariableRow;
}

export async function unlinkHypothesisVariable(
  supabase: SupabaseClient,
  projectId: string,
  linkId: string,
): Promise<void> {
  const { error } = await supabase
    .from(HYPOTHESIS_VARIABLES)
    .delete()
    .eq("id", linkId)
    .eq("project_id", projectId);
  if (error) throw toDbError(error, "unlinkHypothesisVariable");
}

// ---------------------------------------------------------------------
// Scales
// ---------------------------------------------------------------------
export async function listScales(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchScaleRow[]> {
  const { data, error } = await supabase
    .from(SCALES)
    .select("*")
    .eq("project_id", projectId)
    .order("name", { ascending: true });

  if (error) throw toDbError(error, "listScales");
  return data as ResearchScaleRow[];
}

export async function createScale(
  supabase: SupabaseClient,
  input: ResearchScaleInsert,
): Promise<ResearchScaleRow> {
  const { data, error } = await supabase.from(SCALES).insert(input).select("*").single();
  if (error) throw toDbError(error, "createScale");
  return data as ResearchScaleRow;
}

export async function updateScale(
  supabase: SupabaseClient,
  projectId: string,
  scaleId: string,
  patch: Partial<Pick<ResearchScaleRow, "name" | "points" | "polarity">>,
): Promise<ResearchScaleRow> {
  const { data, error } = await supabase
    .from(SCALES)
    .update(stamped(patch))
    .eq("id", scaleId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) throw toDbError(error, "updateScale");
  if (!data) throw new DbError("updateScale: scale not found", true);
  return data as ResearchScaleRow;
}

export async function deleteScale(
  supabase: SupabaseClient,
  projectId: string,
  scaleId: string,
): Promise<void> {
  const { error } = await supabase.from(SCALES).delete().eq("id", scaleId).eq("project_id", projectId);
  if (error) throw toDbError(error, "deleteScale");
}
