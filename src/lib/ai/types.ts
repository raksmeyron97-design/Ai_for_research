export type ProviderName = "gemini" | "openai";

export type ModelTier = "simple" | "standard" | "advanced" | "reviewer";

/**
 * Research task types the classifier can recognize. Keep in sync with
 * prompts/ (one specialized prompt builder per task) and TASK_TIER_MAP
 * in task-classifier.ts.
 */
export type TaskType =
  | "chat"
  | "rewrite"
  | "summarize"
  | "translate"
  | "outline"
  | "topic_generation"
  | "problem_statement"
  | "rationale"
  | "research_gap"
  | "objective_generation"
  | "research_question"
  | "variable_generation"
  | "conceptual_framework"
  | "methodology"
  | "sampling"
  | "sample_size"
  | "instrument"
  | "questionnaire"
  | "literature_review"
  | "source_search"
  | "citation"
  | "reference_formatting"
  | "data_cleaning"
  | "data_analysis"
  | "results_generation"
  | "discussion"
  | "conclusion"
  | "quality_check"
  | "methodology_audit"
  | "document_review";

export type ResponseMode =
  | "ask"
  | "improve"
  | "explain"
  | "generate"
  | "check"
  | "compare"
  | "cite"
  | "shorten"
  | "expand"
  | "translate"
  | "rewrite"
  | "review";

/** Evidence/claim status per the research integrity guard (never silently fabricate). */
export type EvidenceStatus =
  | "verified"
  | "source_required"
  | "user_provided"
  | "inference"
  | "unverified";

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  estimatedCostUsd?: number;
}

export interface Citation {
  citationKey: string;
  title?: string;
  authors?: string[];
  year?: number;
  journal?: string;
  doi?: string;
  url?: string;
  sourceType?: string;
  status: EvidenceStatus;
}

export interface Source {
  id: string;
  title: string;
  url?: string;
  tier?: 1 | 2 | 3 | 4;
  snippet?: string;
}

export interface ResearchWarning {
  severity: "critical" | "high" | "medium" | "low" | "informational";
  category: string;
  message: string;
  recommendation?: string;
}

/** Normalized request shape for every AI call in the app (Section 45). */
export interface AIRequest {
  projectId: string;
  taskType: TaskType;
  message?: string;
  sectionId?: string;
  documentIds?: string[];
  sourceIds?: string[];
  dataSetId?: string;
  language?: "km" | "en";
  mode?: ResponseMode;
  /** Pre-assembled context (project profile + section + retrieved chunks). Built by ContextManager, not the provider. */
  context?: string;
  /** Force dual-model verification regardless of classifier output. */
  requireVerification?: boolean;
}

/** Normalized response shape for every AI call in the app (Section 46). */
export interface AIResponse {
  content: string;
  structuredData?: unknown;
  citations?: Citation[];
  warnings?: ResearchWarning[];
  sources?: Source[];
  provider: ProviderName;
  model: string;
  usage?: TokenUsage;
}

export interface AIChunk {
  delta: string;
  done: boolean;
}

export interface TokenCountRequest {
  model: string;
  text: string;
}

/**
 * Provider-facing request: what AIOrchestrator sends to a concrete provider
 * after context assembly and prompt construction. Distinct from AIRequest,
 * which is the app-facing contract.
 */
export interface ProviderGenerateRequest {
  model: string;
  systemInstruction?: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface AIProvider {
  readonly name: ProviderName;
  generate(request: ProviderGenerateRequest): Promise<AIResponse>;
  stream?(request: ProviderGenerateRequest): AsyncIterable<AIChunk>;
  countTokens?(request: TokenCountRequest): Promise<TokenUsage>;
}

export interface TaskClassification {
  taskType: TaskType;
  complexity: ModelTier;
  provider: ProviderName;
  needsWeb: boolean;
  needsDocuments: boolean;
  needsData: boolean;
  needsCitations: boolean;
}
