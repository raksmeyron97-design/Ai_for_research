import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderName, TaskType, TokenUsage } from "./types";

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
  createdAt: string;
}

/**
 * USD per 1M tokens. Placeholder rates — update from each provider's
 * pricing page before relying on cost figures for budgeting. Unknown
 * models fall back to DEFAULT_RATE so cost tracking never throws.
 */
const RATE_TABLE: Record<string, { input: number; output: number }> = {
  "gemini-3.5-flash-lite": { input: 0.02, output: 0.08 },
  "gemini-3.6-flash": { input: 0.075, output: 0.3 },
  "gpt-5.6": { input: 1.5, output: 6 },
};

const DEFAULT_RATE = { input: 0.5, output: 1.5 };

/** Rough fallback estimate (~4 chars/token) for providers without a countTokens API. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function calculateCost(model: string, usage: TokenUsage): number {
  const rate = RATE_TABLE[model] ?? DEFAULT_RATE;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  return (input / 1_000_000) * rate.input + (output / 1_000_000) * rate.output;
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

  return {
    projectId: params.projectId,
    userId: params.userId,
    taskType: params.taskType,
    provider: params.provider,
    model: params.model,
    inputTokens,
    outputTokens,
    estimatedCostUsd: calculateCost(params.model, { inputTokens, outputTokens }),
    latencyMs: params.latencyMs,
    success: params.success,
    fallback: params.fallback,
    tokensMeasured,
    createdAt: new Date().toISOString(),
  };
}
