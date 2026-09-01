/**
 * Phase 16 benchmark types.
 *
 * The harness measures the *production* AI code path (src/lib/ai/**) rather
 * than a parallel re-implementation: scenarios are turned into real
 * `AIRequest`s, the real prompt-manager builds the system instruction, and
 * the real provider adapters make the call. What the harness owns is
 * everything around that call — scenario definition, deterministic
 * evaluation, cost/latency accounting, limits, and reporting.
 */
import type { ProviderName, TaskType } from "@/lib/ai/types";

export const BENCHMARK_VERSION = "16.0.0";

/** How a measurement was obtained. Never conflate these in a report. */
export type ExecutionMode =
  /** A real provider call over the network succeeded. */
  | "LIVE"
  /** A deterministic in-process stub answered; proves the pipeline, proves nothing about model quality. */
  | "MOCKED"
  /** A real call succeeded only after falling back to another provider/model. */
  | "DEGRADED"
  /** No call was made or none could succeed (missing credentials, network, quota). */
  | "UNAVAILABLE";

export type BenchmarkCategory =
  | "academic_qa"
  | "literature_synthesis"
  | "thesis_outline"
  | "methodology_reasoning"
  | "questionnaire"
  | "rag_grounding"
  | "citation"
  | "hallucination"
  | "khmer_writing"
  | "english_writing"
  | "summarization"
  | "structured_output";

export type Difficulty = "easy" | "medium" | "hard";

export type BenchmarkLanguage = "en" | "km" | "mixed";

/** RAG answerability classes from Phase 16 Step 6. */
export type RagClass =
  | 1 // fully answerable from the retrieved sources
  | 2 // partially answerable — some claims unsupported
  | 3 // not answerable — must abstain
  | 4; // adversarial — distractor sources present

export type FailureType =
  | "RETRIEVAL_FAILURE"
  | "GROUNDING_FAILURE"
  | "CITATION_FAILURE"
  | "HALLUCINATION"
  | "REASONING_FAILURE"
  | "LANGUAGE_FAILURE"
  | "PROMPT_FAILURE"
  | "CONTEXT_OVERFLOW"
  | "MODEL_LIMITATION"
  | "API_FAILURE"
  | "TIMEOUT"
  | "RATE_LIMIT"
  | "PARSING_FAILURE"
  | "SAFETY_REFUSAL"
  | "UNEXPECTED_OUTPUT";

/** One source record in the synthetic benchmark library. */
export interface BenchmarkSource {
  citationKey: string;
  title: string;
  authors: string[];
  year: number;
  journal: string;
  /** Reserved non-registrant prefix (10.0000/) — these are fixtures, never real DOIs. */
  doi: string;
  /** Excerpt text the model is allowed to ground on. */
  content: string;
  /** Facts a correct answer may assert from this source, used by the grounding evaluator. */
  supports: string[];
}

export interface BenchmarkCorpus {
  id: string;
  domain: "antenatal_postpartum_mental_health" | "maternal_nutrition";
  sources: BenchmarkSource[];
}

/** Deterministic expectations. Anything "plausible" must not be able to pass. */
export interface ScenarioExpectations {
  /** Citation keys that MUST appear (recall denominator). */
  mustCite?: string[];
  /** Keys that must NOT appear — distractors, or sources that do not support the claim. */
  mustNotCite?: string[];
  /** The answer must explicitly decline / flag insufficient evidence. */
  mustAbstain?: boolean;
  /** Concepts (case-insensitive substrings, any-of groups) the answer must cover. */
  mustMention?: string[][];
  /** Strings that must not appear (fabricated specifics, forbidden claims). */
  mustNotContain?: string[];
  /** Must acknowledge that provided sources disagree. */
  mustAcknowledgeConflict?: boolean;
  /** Must correct a false premise embedded in the question. */
  mustCorrectPremise?: boolean;
  /** Structured-output schema the response must validate against. */
  schema?: "questionnaire" | "quality_check" | "alignment";
  /** Numbers the model may state; any other numeric claim counts as unsupported. */
  allowedNumbers?: string[];
  minWords?: number;
  maxWords?: number;
  /** Terms that must be rendered consistently throughout (terminology drift check). */
  consistentTerms?: string[];
}

export interface BenchmarkScenario {
  id: string;
  category: BenchmarkCategory;
  difficulty: Difficulty;
  language: BenchmarkLanguage;
  /** Production TaskType — determines which real system prompt and tier is exercised. */
  task: TaskType;
  input: string;
  expected_behavior: string;
  ground_truth: string;
  retrieval_required: boolean;
  citation_required: boolean;
  ragClass?: RagClass;
  /** Corpus id whose sources are injected as "## Relevant Document Excerpts". */
  corpus?: string;
  /** Subset of corpus source keys treated as retrieved for this scenario. */
  retrievedKeys?: string[];
  expect: ScenarioExpectations;
}

/**
 * Prompt/context A/B arms (Step 21). "A" is production exactly as shipped.
 * "B" changes one thing at a time — see `runners/variants.ts` — so a
 * measured difference is attributable.
 */
export type Variant = "A" | "B";

export interface TokenAccounting {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Gemini thoughtsTokenCount / OpenAI reasoning_tokens. */
  reasoningTokens?: number;
  cachedInputTokens?: number;
  /** Tokens of retrieved context we put into the prompt (measured on our side). */
  retrievedContextTokens: number;
  promptTokens: number;
  /** True when input/output came from the provider, false when locally estimated. */
  fromProvider: boolean;
}

export interface CostAccounting {
  estimatedCostUsd: number | null;
  /** Where the per-token rate came from. Cost is meaningless without this. */
  rateSource: "verified_rate_file" | "unverified_placeholder" | "unknown_model";
}

export interface ExecutionRecord {
  timestamp: string;
  runId: string;
  benchmarkVersion: string;
  scenarioId: string;
  category: BenchmarkCategory;
  provider: ProviderName;
  /** The exact model id actually executed. */
  model: string;
  sdkVersion: string;
  apiMode: string;
  mode: ExecutionMode;
  variant: Variant;
  /** Which context rendering was used — see fixtures/context.ts. */
  contextFormat: "keyed" | "numbered" | "none";
  repetition: number;
  latencyMs: number;
  /** Time to first token; only measurable on the streaming path. */
  firstTokenMs: number | null;
  attempts: number;
  retries: number;
  ok: boolean;
  output: string;
  tokens: TokenAccounting;
  cost: CostAccounting;
  failureType: FailureType | null;
  errorMessage: string | null;
}

export interface DimensionScores {
  factualCorrectness: number | null;
  groundedness: number | null;
  citationCorrectness: number | null;
  researchReasoning: number | null;
  khmerQuality: number | null;
  englishQuality: number | null;
  hallucinationResistance: number | null;
  instructionFollowing: number | null;
  conciseness: number | null;
}

export interface EvaluationDetail {
  evaluator: string;
  passed: boolean;
  score: number | null;
  notes: string[];
}

export interface CitationMetrics {
  cited: string[];
  expected: string[];
  correct: number;
  /** Cited keys that exist in the corpus but were not expected to support the claim. */
  mismatched: string[];
  /** Cited keys that exist nowhere in the corpus — invented. */
  fabricated: string[];
  precision: number | null;
  recall: number | null;
}

export interface ScenarioResult {
  execution: ExecutionRecord;
  scores: DimensionScores;
  /** Weighted 0-100, or null when no dimension could be evaluated. */
  overall: number | null;
  details: EvaluationDetail[];
  citations: CitationMetrics | null;
  unsupportedClaims: string[];
  abstained: boolean;
  /** Only populated when an LLM judge actually ran. */
  judge: JudgeResult | null;
}

export interface JudgeResult {
  judgeProvider: ProviderName;
  judgeModel: string;
  judgePromptVersion: string;
  criteria: string[];
  scores: Record<string, number>;
  rationale: string;
  blind: boolean;
}

export interface FailureRecord {
  scenarioId: string;
  provider: ProviderName;
  model: string;
  failureType: FailureType;
  severity: "critical" | "high" | "medium" | "low";
  reproducible: boolean;
  probableCause: string;
  recommendedFix: string;
  observed: string;
  expected: string;
}

export interface ProviderStatus {
  provider: ProviderName;
  credentialPresent: boolean;
  reachable: boolean | null;
  status: ExecutionMode;
  /** Model ids the provider actually reports as available, when discoverable. */
  discoveredModels: string[] | null;
  sdkVersion: string;
  apiMode: string;
  reason: string;
}
