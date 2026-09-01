import { z } from "zod";

const TASK_TYPES = [
  "chat", "rewrite", "summarize", "translate", "outline", "topic_generation",
  "problem_statement", "rationale", "research_gap", "objective_generation",
  "research_question", "variable_generation", "conceptual_framework",
  "methodology", "sampling", "sample_size", "instrument", "questionnaire",
  "literature_review", "source_search", "citation", "reference_formatting",
  "data_cleaning", "data_analysis", "results_generation", "discussion",
  "conclusion", "quality_check", "methodology_audit", "document_review",
] as const;

const RESPONSE_MODES = [
  "ask", "improve", "explain", "generate", "check", "compare", "cite",
  "shorten", "expand", "translate", "rewrite", "review",
] as const;

/** Validates every inbound AI request before it reaches the orchestrator (Section 39: input validation at the boundary). */
export const aiRequestSchema = z.object({
  projectId: z.string().uuid(),
  taskType: z.enum(TASK_TYPES),
  message: z.string().max(20_000).optional(),
  sectionId: z.string().optional(),
  documentIds: z.array(z.string()).max(20).optional(),
  sourceIds: z.array(z.string()).max(50).optional(),
  dataSetId: z.string().optional(),
  language: z.enum(["km", "en"]).optional(),
  mode: z.enum(RESPONSE_MODES).optional(),
  context: z.string().max(50_000).optional(),
  requireVerification: z.boolean().optional(),
  /** If given, the turn is appended to this existing ai_conversations row instead of starting a new one. */
  conversationId: z.string().uuid().optional(),
});

export type ValidatedAIRequest = z.infer<typeof aiRequestSchema>;
