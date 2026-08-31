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
 * In Phase 1 this logs a structured record for observability. Phase 10
 * (analytics) persists these to an AIUsage table for the admin dashboard —
 * swap the sink here without touching call sites.
 */
export function recordUsage(record: UsageRecord): void {
  console.log(
    JSON.stringify({
      type: "ai_usage",
      ...record,
    }),
  );
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
    createdAt: new Date().toISOString(),
  };
}
