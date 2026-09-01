import type { AIRequest, TaskType } from "../types";
import { buildConclusionSystemInstruction } from "./conclusion";
import { buildDefaultSystemInstruction } from "./default";
import { buildDiscussionSystemInstruction } from "./discussion";
import { buildLiteratureSystemInstruction } from "./literature";
import { buildMethodologySystemInstruction } from "./methodology";
import { buildObjectivesSystemInstruction } from "./objectives";
import { buildProblemStatementSystemInstruction, buildRationaleSystemInstruction } from "./problem";
import { buildQualityCheckSystemInstruction } from "./quality-check";
import { buildResearchQuestionsSystemInstruction } from "./questions";
import { buildTitleSystemInstruction } from "./title";
import { buildConceptualFrameworkSystemInstruction, buildVariablesSystemInstruction } from "./variables";

type PromptBuilder = (request: AIRequest) => string;

/**
 * One specialized prompt per research task (Section 22) — not a single
 * generic template. Phase 16 added title, problem statement, rationale,
 * research questions, variables and conceptual framework, and gave research
 * questions their own builder: they previously shared the objectives prompt,
 * which asks for objectives (audit finding D7).
 *
 * Task types still on the default builder are the ones whose guarantees come
 * from code rather than from prompting — the questionnaire and results
 * generators validate against schemas and computed statistics — plus the
 * genuinely generic ones (chat, summarize, translate).
 */
const PROMPT_REGISTRY: Partial<Record<TaskType, PromptBuilder>> = {
  topic_generation: buildTitleSystemInstruction,
  problem_statement: buildProblemStatementSystemInstruction,
  rationale: buildRationaleSystemInstruction,
  objective_generation: buildObjectivesSystemInstruction,
  research_question: buildResearchQuestionsSystemInstruction,
  variable_generation: buildVariablesSystemInstruction,
  conceptual_framework: buildConceptualFrameworkSystemInstruction,
  methodology: buildMethodologySystemInstruction,
  sampling: buildMethodologySystemInstruction,
  sample_size: buildMethodologySystemInstruction,
  methodology_audit: buildMethodologySystemInstruction,
  quality_check: buildQualityCheckSystemInstruction,
  literature_review: buildLiteratureSystemInstruction,
  source_search: buildLiteratureSystemInstruction,
  discussion: buildDiscussionSystemInstruction,
  conclusion: buildConclusionSystemInstruction,
};

export function buildTaskSystemInstruction(request: AIRequest): string {
  const builder = PROMPT_REGISTRY[request.taskType] ?? buildDefaultSystemInstruction;
  return builder(request);
}
