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
  /**
   * Provider-reported "thinking"/reasoning tokens (Gemini
   * `thoughtsTokenCount`, OpenAI `output_tokens_details.reasoning_tokens`).
   * Billed as output but not included in `outputTokens`, so for a reasoning
   * model `inputTokens + outputTokens` does not reconcile with
   * `totalTokens`. Captured in Phase 16 so token/cost measurement can see
   * them; `calculateCost()` still bills input+output only, which
   * under-counts for these models — see PHASE_16_REAL_AI_VALIDATION_REPORT.md.
   */
  reasoningTokens?: number;
  /** Prompt tokens served from the provider's cache; billed at a reduced rate. */
  cachedInputTokens?: number;
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

export type IssueSeverity = "critical" | "high" | "medium" | "low" | "informational";

/**
 * Doubles as the master spec's "ResearchValidationIssue" (§20) — that
 * shape (severity/category/section/message/recommendation) is exactly
 * ResearchWarning plus a `section` field, so this is one type rather than
 * two near-duplicates. `section` is a plain string, not `SectionType`
 * (from db/types.ts), to keep this foundational types file free of a
 * dependency on the db layer.
 */
export interface ResearchWarning {
  severity: IssueSeverity;
  category: string;
  section?: string;
  message: string;
  recommendation?: string;
}

/** Section 33's score breakdown — always presented as an "AI Quality Estimate," never an official grade. */
export interface QualityScoreBreakdown {
  methodology: number;
  evidence: number;
  alignment: number;
  writing: number;
  references: number;
  dataIntegrity: number;
  overall: number;
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
  /**
   * JSON Schema for structured output. When set, the provider is asked to
   * use its native structured-output mode (Gemini's responseSchema,
   * OpenAI's json_schema response format) rather than free text — the
   * caller then JSON.parses `AIResponse.content` with confidence it
   * matches the schema, instead of regex-scraping prose (spec §36).
   */
  responseSchema?: Record<string, unknown>;
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
  responseSchema?: Record<string, unknown>;
  /**
   * Cancellation signal, forwarded by each adapter to its SDK so that
   * `withRetry`'s timeout actually aborts the in-flight HTTP request.
   * Before Phase 16 the signal was created and dropped, which made the
   * timeout inert (report finding F1).
   */
  signal?: AbortSignal;
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
