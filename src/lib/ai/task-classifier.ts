import { AI_FEATURE_FLAGS } from "./model-config";
import type { AIRequest, ModelTier, ProviderName, TaskClassification, TaskType } from "./types";

interface TaskMeta {
  tier: ModelTier;
  needsWeb: boolean;
  needsDocuments: boolean;
  needsData: boolean;
  needsCitations: boolean;
}

/**
 * Static routing table (Section 6/9). This is intentionally rule-based, not
 * model-based classification — cheap and deterministic, so we never spend a
 * model call just to decide which model to call.
 */
const TASK_META: Record<TaskType, TaskMeta> = {
  chat: { tier: "standard", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: false },
  rewrite: { tier: "simple", needsWeb: false, needsDocuments: false, needsData: false, needsCitations: false },
  summarize: { tier: "simple", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: false },
  translate: { tier: "simple", needsWeb: false, needsDocuments: false, needsData: false, needsCitations: false },
  outline: { tier: "simple", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: false },
  topic_generation: { tier: "standard", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: false },
  problem_statement: { tier: "standard", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: false },
  rationale: { tier: "standard", needsWeb: true, needsDocuments: true, needsData: false, needsCitations: true },
  research_gap: { tier: "advanced", needsWeb: true, needsDocuments: true, needsData: false, needsCitations: true },
  objective_generation: { tier: "standard", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: false },
  research_question: { tier: "standard", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: false },
  variable_generation: { tier: "standard", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: false },
  conceptual_framework: { tier: "standard", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: true },
  methodology: { tier: "standard", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: false },
  sampling: { tier: "standard", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: false },
  sample_size: { tier: "standard", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: false },
  instrument: { tier: "standard", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: false },
  questionnaire: { tier: "standard", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: false },
  literature_review: { tier: "standard", needsWeb: true, needsDocuments: true, needsData: false, needsCitations: true },
  source_search: { tier: "standard", needsWeb: true, needsDocuments: false, needsData: false, needsCitations: true },
  citation: { tier: "simple", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: true },
  reference_formatting: { tier: "simple", needsWeb: false, needsDocuments: false, needsData: false, needsCitations: true },
  data_cleaning: { tier: "standard", needsWeb: false, needsDocuments: false, needsData: true, needsCitations: false },
  data_analysis: { tier: "advanced", needsWeb: false, needsDocuments: false, needsData: true, needsCitations: false },
  results_generation: { tier: "standard", needsWeb: false, needsDocuments: false, needsData: true, needsCitations: false },
  discussion: { tier: "standard", needsWeb: true, needsDocuments: true, needsData: true, needsCitations: true },
  conclusion: { tier: "standard", needsWeb: false, needsDocuments: true, needsData: true, needsCitations: false },
  quality_check: { tier: "advanced", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: true },
  methodology_audit: { tier: "advanced", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: true },
  document_review: { tier: "standard", needsWeb: false, needsDocuments: true, needsData: false, needsCitations: false },
};

function tierToProvider(tier: ModelTier): ProviderName {
  return tier === "advanced" || tier === "reviewer" ? "openai" : "gemini";
}

/**
 * Classifies a request into a model tier + provider before any model is
 * called (Section 9/10). Cheap logic first: this never invokes an LLM.
 */
export function classifyTask(request: AIRequest): TaskClassification {
  const meta = TASK_META[request.taskType];
  let tier = meta.tier;
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

  return {
    taskType: request.taskType,
    complexity: tier,
    provider,
    needsWeb: meta.needsWeb && AI_FEATURE_FLAGS.webGroundingEnabled,
    needsDocuments: meta.needsDocuments && Boolean(request.documentIds?.length),
    needsData: meta.needsData && Boolean(request.dataSetId),
    needsCitations: meta.needsCitations,
  };
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
