import { AI_FEATURE_FLAGS } from "./model-config";
import type { AIRequest, ModelTier, ProviderName, TaskClassification, TaskType } from "./types";

/**
 * Static routing table (Section 6/9). This is intentionally rule-based, not
 * model-based classification — cheap and deterministic, so we never spend a
 * model call just to decide which model to call.
 *
 * Phase 16A removed the per-task `needsWeb` / `needsDocuments` / `needsData` /
 * `needsCitations` booleans that used to sit alongside the tier: they were
 * computed on every request and read by nothing, and no adapter ever passed a
 * grounding or file-search tool to its SDK (findings F4/F5). What remains is
 * the one thing this table is actually consulted for.
 */
const TASK_TIER: Record<TaskType, ModelTier> = {
  chat: "standard",
  rewrite: "simple",
  summarize: "simple",
  translate: "simple",
  outline: "simple",
  topic_generation: "standard",
  problem_statement: "standard",
  rationale: "standard",
  research_gap: "advanced",
  objective_generation: "standard",
  research_question: "standard",
  variable_generation: "standard",
  conceptual_framework: "standard",
  methodology: "standard",
  sampling: "standard",
  sample_size: "standard",
  instrument: "standard",
  questionnaire: "standard",
  literature_review: "standard",
  source_search: "standard",
  citation: "simple",
  reference_formatting: "simple",
  data_cleaning: "standard",
  data_analysis: "advanced",
  results_generation: "standard",
  discussion: "standard",
  conclusion: "standard",
  quality_check: "advanced",
  methodology_audit: "advanced",
  document_review: "standard",
};

function tierToProvider(tier: ModelTier): ProviderName {
  return tier === "advanced" || tier === "reviewer" ? "openai" : "gemini";
}

/**
 * Classifies a request into a model tier + provider before any model is
 * called (Section 9/10). Cheap logic first: this never invokes an LLM.
 */
export function classifyTask(request: AIRequest): TaskClassification {
  let tier = TASK_TIER[request.taskType];
  let provider = tierToProvider(tier);

  // Respect feature flags: if the tier's default provider is disabled,
  // fall back to whichever provider is enabled rather than failing here.
  // AIProviderRouter still enforces this at call time; this is a best-effort hint.
  if (provider === "openai" && !AI_FEATURE_FLAGS.openaiEnabled) {
    provider = "gemini";
    tier = tier === "advanced" ? "standard" : tier;
  } else if (provider === "gemini" && !AI_FEATURE_FLAGS.geminiEnabled) {
    provider = "openai";
  }

  return { taskType: request.taskType, complexity: tier, provider };
}

/**
 * Dual-model verification is opt-in and reserved for high-risk tasks
 * (Section 6): never run automatically on every request.
 */
export function needsVerification(request: AIRequest, classification: TaskClassification): boolean {
  if (request.requireVerification) return true;
  const highRiskTasks: TaskType[] = ["methodology_audit", "quality_check", "research_gap"];
  return classification.complexity === "advanced" && highRiskTasks.includes(request.taskType);
}
