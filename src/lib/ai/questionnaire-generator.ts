import type { SupabaseClient } from "@supabase/supabase-js";
import { createInstrument } from "../db/instruments";
import { insertQuestions } from "../db/questions";
import { getProject } from "../db/projects";
import { getSection } from "../db/sections";
import type {
  QuestionnaireQuestionInsert,
  QuestionnaireQuestionRow,
  ResearchInstrumentRow,
} from "../db/types";
import { AIOrchestrator } from "./orchestrator";
import { QUESTIONNAIRE_RESPONSE_JSON_SCHEMA, questionnaireResponseSchema } from "./schemas";

export class QuestionnaireGenerationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "QuestionnaireGenerationError";
  }
}

export interface GeneratedQuestionnaire {
  instrument: ResearchInstrumentRow;
  questions: QuestionnaireQuestionRow[];
}

/**
 * Generates a full questionnaire (spec §25) grounded in the project's
 * profile, objectives, variables, and rationale. Unlike the alignment
 * engine/quality checker (which degrade to a "check didn't run cleanly"
 * issue on a bad response), a malformed response here is not persisted
 * at all — this writes new instrument/question rows, and partially
 * writing an instrument that failed the validated-instrument-safety
 * check (Section 26) would be worse than reporting a clean failure and
 * letting the caller retry.
 */
export async function generateQuestionnaire(
  supabase: SupabaseClient,
  projectId: string,
  options: { userId?: string } = {},
): Promise<GeneratedQuestionnaire> {
  const project = await getProject(supabase, projectId);
  if (!project) {
    throw new QuestionnaireGenerationError(`generateQuestionnaire: project ${projectId} not found`);
  }

  const context = await buildQuestionnaireContext(supabase, projectId, project);

  const orchestrator = new AIOrchestrator({ userId: options.userId, supabase });
  const response = await orchestrator.generate({
    projectId,
    taskType: "questionnaire",
    message:
      "Design a questionnaire for this project: group questions into sections (e.g. Demographics, Knowledge, Attitude, Practice, Barriers as appropriate), and map every question to the objective/variable/construct it measures. If this adapts a real named instrument (e.g. EPDS, a WHO tool), say so and cite it — otherwise mark it researcher_developed. Never claim an instrument is validated or adapted without naming what it's based on.",
    context,
    responseSchema: QUESTIONNAIRE_RESPONSE_JSON_SCHEMA,
  });

  const parsed = parseQuestionnaireResponse(response.content);

  const instrument = await createInstrument(supabase, {
    project_id: projectId,
    name: parsed.instrument.name,
    validation_status: parsed.instrument.validation_status,
    source_reference: parsed.instrument.source_reference || null,
    adaptation_notes: parsed.instrument.adaptation_notes || null,
  });

  const questionInserts: QuestionnaireQuestionInsert[] = [];
  let orderIndex = 0;
  for (const section of parsed.sections) {
    for (const question of section.questions) {
      questionInserts.push({
        instrument_id: instrument.id,
        project_id: projectId,
        section_label: section.section_label,
        objective_label: question.objective_label || null,
        variable_label: question.variable_label || null,
        construct: question.construct || null,
        question_text: question.question_text,
        response_type: question.response_type,
        options: question.options.length > 0 ? question.options : null,
        required: question.required,
        order_index: orderIndex++,
      });
    }
  }

  const questions = await insertQuestions(supabase, questionInserts);

  return { instrument, questions };
}

async function buildQuestionnaireContext(
  supabase: SupabaseClient,
  projectId: string,
  project: { title: string; discipline: string | null; study_design: string | null; target_population: string[] },
): Promise<string> {
  const [objectives, variables, rationale] = await Promise.all([
    getSection(supabase, projectId, "objectives"),
    getSection(supabase, projectId, "variables"),
    getSection(supabase, projectId, "rationale"),
  ]);

  const parts = [
    `## Project Profile\nTitle: ${project.title}\nDiscipline: ${project.discipline ?? "(none given)"}\nStudy Design: ${project.study_design ?? "(none given)"}\nTarget Population: ${project.target_population.join(", ") || "(none given)"}`,
    objectives?.content && `## Objectives\n${objectives.content}`,
    variables?.content && `## Variables\n${variables.content}`,
    rationale?.content && `## Rationale\n${rationale.content}`,
  ].filter((p): p is string => Boolean(p));

  return parts.join("\n\n");
}

function parseQuestionnaireResponse(content: string) {
  let json: unknown;
  try {
    json = JSON.parse(content);
  } catch (err) {
    throw new QuestionnaireGenerationError(
      "The model did not return valid JSON for the questionnaire. Nothing was saved — try again.",
      err,
    );
  }

  const result = questionnaireResponseSchema.safeParse(json);
  if (!result.success) {
    throw new QuestionnaireGenerationError(
      `The generated questionnaire failed validation (${result.error.issues[0]?.message ?? "unknown reason"}). Nothing was saved — try again.`,
      result.error,
    );
  }

  return result.data;
}
