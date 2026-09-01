import type { AIRequest, TaskType } from "../types";
import { buildConclusionSystemInstruction } from "./conclusion";
import { buildDefaultSystemInstruction } from "./default";
import { buildDiscussionSystemInstruction } from "./discussion";
import { buildLiteratureSystemInstruction } from "./literature";
import { buildMethodologySystemInstruction } from "./methodology";
import { buildObjectivesSystemInstruction } from "./objectives";
import { buildQualityCheckSystemInstruction } from "./quality-check";

type PromptBuilder = (request: AIRequest) => string;

/**
 * One specialized prompt per research section (Section 22) — not a single
 * generic template. Add a new file under prompts/ and register it here as
 * the section generators for Phase 2+ come online (variables, questionnaire,
 * results, references, ...).
 */
const PROMPT_REGISTRY: Partial<Record<TaskType, PromptBuilder>> = {
  objective_generation: buildObjectivesSystemInstruction,
  research_question: buildObjectivesSystemInstruction,
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
