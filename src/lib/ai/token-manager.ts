import type { SupabaseClient } from "@supabase/supabase-js";
import { computeUsageCost } from "./pricing";
import type { CostConfidence, ProviderName, TaskType, TokenUsage } from "./types";

export interface UsageRecord {
  projectId: string;
  userId?: string;
  taskType: TaskType;
  provider: ProviderName;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCostUsd: number;
  latencyMs: number;
  success: boolean;
  fallback: boolean;
  /**
   * True when the token counts came from the provider's own usage metadata,
   * false when they were estimated from text length. Recorded so the admin
   * dashboard can state what share of its cost total is actually measured
   * rather than presenting both kinds identically (finding F6).
   */
  tokensMeasured: boolean;
  /**
   * Whether `estimatedCostUsd` came from a rate verified against the
   * provider's published pricing. `unverified` means no dollar figure is
   * authoritative for this row — the value will be 0 (finding F7).
   */
  costConfidence: CostConfidence;
  createdAt: string;
}

/** Rough fallback estimate (~4 chars/token) for providers without a countTokens API. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Cost for a call, or null when the model has no verified rate. Returning
 * null rather than a default-rate guess is the point: a number nobody can
 * source is worse than an admitted gap, because it gets summed into a
 * dashboard and read as a bill. Reasoning and cached-input tokens are
 * handled per provider — see `pricing.ts`.
 */
export function calculateCost(model: string, usage: TokenUsage): number | null {
  const priced = computeUsageCost(model, usage);
  return priced.costConfidence === "verified" ? (priced.totalCostUsd ?? null) : null;
}

/**
 * Persists to the `ai_usage` table (Phase 10) when a request-scoped
 * Supabase client is available — the admin analytics dashboard reads from
 * this table. Falls back to a structured console log when no client is
 * passed (e.g. contexts without a request, or tests), so this never
 * becomes a hard requirement to call the orchestrator. Insert failures are
 * swallowed after logging: usage tracking must never break the actual AI
 * response it's recording.
 */
export async function recordUsage(supabase: SupabaseClient | undefined, record: UsageRecord): Promise<void> {
  if (!supabase) {
    console.log(JSON.stringify({ type: "ai_usage", ...record }));
    return;
  }

  const { error } = await supabase.from("ai_usage").insert({
    project_id: record.projectId,
    user_id: record.userId ?? null,
    task_type: record.taskType,
    provider: record.provider,
    model: record.model,
    input_tokens: record.inputTokens,
    output_tokens: record.outputTokens,
    estimated_cost_usd: record.estimatedCostUsd,
    latency_ms: record.latencyMs,
    success: record.success,
    fallback: record.fallback,
    tokens_measured: record.tokensMeasured,
    cost_confidence: record.costConfidence,
  });
  if (error) {
    console.error(JSON.stringify({ type: "ai_usage_persist_failed", error: error.message, ...record }));
  }
}

export function buildUsageRecord(params: {
  projectId: string;
  userId?: string;
  taskType: TaskType;
  provider: ProviderName;
  model: string;
  usage?: TokenUsage;
  promptText?: string;
  outputText?: string;
  latencyMs: number;
  success: boolean;
  fallback: boolean;
}): UsageRecord {
  // "Measured" means the provider told us, for either direction. A partial
  // report (input only, say) still beats an estimate, but it is not a full
  // measurement, so both must be present to claim one.
  const tokensMeasured =
    params.usage?.inputTokens !== undefined && params.usage?.outputTokens !== undefined;

  const inputTokens =
    params.usage?.inputTokens ?? (params.promptText ? estimateTokens(params.promptText) : 0);
  const outputTokens =
    params.usage?.outputTokens ?? (params.outputText ? estimateTokens(params.outputText) : 0);

  // Reasoning and cached-input counts only exist when the provider reported
  // usage; they are passed through so pricing can apply the right billing
  // semantics for this provider.
  const priced = computeUsageCost(params.model, {
    inputTokens,
    outputTokens,
    reasoningTokens: params.usage?.reasoningTokens,
    cachedInputTokens: params.usage?.cachedInputTokens,
    totalTokens: params.usage?.totalTokens,
  });

  return {
    projectId: params.projectId,
    userId: params.userId,
    taskType: params.taskType,
    provider: params.provider,
    model: params.model,
    inputTokens,
    outputTokens,
    // 0 when unverified: the column is non-null, and cost_confidence is what
    // tells a reader that this zero means "unknown", not "free".
    estimatedCostUsd: priced.costConfidence === "verified" ? (priced.totalCostUsd ?? 0) : 0,
    costConfidence: priced.costConfidence,
    latencyMs: params.latencyMs,
    success: params.success,
    fallback: params.fallback,
    tokensMeasured,
    createdAt: new Date().toISOString(),
  };
}
