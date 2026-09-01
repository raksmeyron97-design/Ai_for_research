import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError } from "./errors";
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

export async function updateQuestion(
  supabase: SupabaseClient,
  questionId: string,
  patch: Partial<Pick<QuestionnaireQuestionRow, "question_text" | "response_type" | "options" | "required" | "order_index">>,
): Promise<QuestionnaireQuestionRow> {
  const { data, error } = await supabase.from(TABLE).update(patch).eq("id", questionId).select("*").single();
  if (error) throw toDbError(error, "updateQuestion");
  return data as QuestionnaireQuestionRow;
}

export async function deleteQuestion(supabase: SupabaseClient, questionId: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", questionId);
  if (error) throw toDbError(error, "deleteQuestion");
}
