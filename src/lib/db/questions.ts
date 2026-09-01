import type { SupabaseClient } from "@supabase/supabase-js";
import { DbError, toDbError } from "./errors";
import type { QuestionnaireQuestionInsert, QuestionnaireQuestionRow } from "./types";

const TABLE = "questionnaire_questions";

export async function listQuestions(
  supabase: SupabaseClient,
  instrumentId: string,
): Promise<QuestionnaireQuestionRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("instrument_id", instrumentId)
    .order("order_index", { ascending: true });

  if (error) throw toDbError(error, "listQuestions");
  return data as QuestionnaireQuestionRow[];
}

/** Bulk insert — the generator persists a whole instrument's questions in one call. */
export async function insertQuestions(
  supabase: SupabaseClient,
  questions: QuestionnaireQuestionInsert[],
): Promise<QuestionnaireQuestionRow[]> {
  if (questions.length === 0) return [];
  const { data, error } = await supabase.from(TABLE).insert(questions).select("*");
  if (error) throw toDbError(error, "insertQuestions");
  return data as QuestionnaireQuestionRow[];
}

/**
 * Every item in the project, across instruments.
 *
 * The coverage matrix and the consistency engine reason about the whole
 * measurement set — an indicator is uncovered whether or not the item that
 * would cover it happens to sit in the instrument currently open. Selecting
 * the mapping columns rather than `*` keeps the option lists and full question
 * prose out of a query that only needs the edges of the graph (§35).
 */
export async function listQuestionsForProject(
  supabase: SupabaseClient,
  projectId: string,
): Promise<QuestionnaireQuestionRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("project_id", projectId)
    .order("order_index", { ascending: true });

  if (error) throw toDbError(error, "listQuestionsForProject");
  return data as QuestionnaireQuestionRow[];
}

export async function getQuestion(
  supabase: SupabaseClient,
  projectId: string,
  questionId: string,
): Promise<QuestionnaireQuestionRow | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", questionId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw toDbError(error, "getQuestion");
  return (data as QuestionnaireQuestionRow) ?? null;
}

/**
 * Project-scoped since Phase 18 (§27). It previously matched on `id` alone,
 * which left RLS as the only thing standing between an item id and another
 * project's questionnaire — the same shape of hole Phase 17 found in the
 * database. The filter costs nothing and removes the dependency.
 */
export async function updateQuestion(
  supabase: SupabaseClient,
  projectId: string,
  questionId: string,
  patch: Partial<
    Pick<
      QuestionnaireQuestionRow,
      | "question_text" | "response_type" | "options" | "required" | "order_index"
      | "section_label" | "construct" | "objective_label" | "variable_label"
      | "construct_id" | "indicator_id" | "scale_id" | "reverse_coded"
      | "item_provenance" | "source_citation_id" | "source_location" | "adaptation_type"
    >
  >,
): Promise<QuestionnaireQuestionRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", questionId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) throw toDbError(error, "updateQuestion");
  if (!data) throw new DbError("updateQuestion: question not found", true);
  return data as QuestionnaireQuestionRow;
}

export async function deleteQuestion(
  supabase: SupabaseClient,
  projectId: string,
  questionId: string,
): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("id", questionId)
    .eq("project_id", projectId);
  if (error) throw toDbError(error, "deleteQuestion");
}
