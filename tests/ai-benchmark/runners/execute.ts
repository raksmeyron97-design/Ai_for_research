import { randomUUID } from "node:crypto";
import { GeminiProvider } from "@/lib/ai/providers/gemini";
import { OpenAIProvider } from "@/lib/ai/providers/openai";
import { buildPrompt } from "@/lib/ai/prompt-manager";
import { estimateTokens } from "@/lib/ai/token-manager";
import { getMaxOutputTokens } from "@/lib/ai/model-config";
import {
  ALIGNMENT_RESPONSE_JSON_SCHEMA,
  QUALITY_CHECK_RESPONSE_JSON_SCHEMA,
  QUESTIONNAIRE_RESPONSE_JSON_SCHEMA,
} from "@/lib/ai/schemas";
import type { AIProvider, AIRequest, ProviderName } from "@/lib/ai/types";
import { computeCost, loadRates, type BenchmarkConfig } from "../config";
import { buildScenarioContext } from "../fixtures/context";
import { classifyApiError } from "../failure-taxonomy";
import { BENCHMARK_VERSION, type BenchmarkScenario, type ExecutionRecord, type Variant } from "../types";
import { apiMode, sdkVersion } from "./preflight";
import { StubProvider, STUB_MODEL_ID } from "./stub-provider";
import { contextFormatFor, systemInstructionFor } from "./variants";

const PROVIDERS: Record<ProviderName, AIProvider> = {
  gemini: GeminiProvider,
  openai: OpenAIProvider,
};

const SCHEMAS = {
  questionnaire: QUESTIONNAIRE_RESPONSE_JSON_SCHEMA,
  quality_check: QUALITY_CHECK_RESPONSE_JSON_SCHEMA,
  alignment: ALIGNMENT_RESPONSE_JSON_SCHEMA,
} as const;

/**
 * Budget and safety rails for a live run (Step 28). This is a hard stop,
 * not advice: once `requestsUsed` reaches `maxRequests`, or SIGINT is
 * received, every remaining unit is skipped rather than executed. The
 * counters are shared across the whole run so a nested loop over
 * providers x models x scenarios x repetitions cannot escape them.
 */
export class RunBudget {
  requestsUsed = 0;
  costUsed = 0;
  cancelled = false;

  constructor(private readonly config: BenchmarkConfig) {}

  get exhausted(): boolean {
    if (this.cancelled) return true;
    if (this.requestsUsed >= this.config.maxRequests) return true;
    if (this.config.maxCostUsd !== null && this.costUsed >= this.config.maxCostUsd) return true;
    return false;
  }

  reason(): string {
    if (this.cancelled) return "run cancelled";
    if (this.requestsUsed >= this.config.maxRequests) return `request ceiling reached (${this.config.maxRequests})`;
    if (this.config.maxCostUsd !== null && this.costUsed >= this.config.maxCostUsd) {
      return `cost ceiling reached (${this.config.maxCostUsd} USD)`;
    }
    return "";
  }

  cancel() {
    this.cancelled = true;
  }
}

/**
 * The harness enforces its own timeout with Promise.race, deliberately not
 * relying on `withRetry` from src/lib/ai/errors.ts: that helper creates an
 * AbortController and passes the signal to its callback, but neither
 * provider adapter forwards the signal to its SDK, so its `timeoutMs` never
 * actually cancels anything. A benchmark that inherited that behaviour
 * could hang indefinitely on one scenario.
 */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`benchmark timeout after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export interface ExecuteParams {
  scenario: BenchmarkScenario;
  provider: ProviderName;
  model: string;
  variant: Variant;
  repetition: number;
  runId: string;
  config: BenchmarkConfig;
  budget: RunBudget;
}

/**
 * Runs one scenario against one model, through the production prompt
 * builders and the production provider adapter. What the harness supplies
 * is the context string (from fixtures rather than a live vector search)
 * and the limits; everything between the prompt and the response is the
 * code that ships.
 */
export async function executeScenario(params: ExecuteParams): Promise<ExecutionRecord> {
  const { scenario, provider, model, variant, repetition, runId, config, budget } = params;

  const format = contextFormatFor(variant);
  const { text: contextText } = buildScenarioContext(scenario, format);

  const request: AIRequest = {
    projectId: "00000000-0000-0000-0000-000000000000",
    taskType: scenario.task,
    message: scenario.input,
    language: scenario.language === "km" ? "km" : "en",
    context: contextText || undefined,
  };

  const systemInstruction = systemInstructionFor(request, variant);
  const prompt = buildPrompt(request);
  const responseSchema = scenario.expect.schema ? SCHEMAS[scenario.expect.schema] : undefined;

  const retrievedContextTokens = estimateTokens(contextText);
  const promptTokens = estimateTokens(`${systemInstruction}\n${prompt}`);
  const rates = loadRates(config.rateFile);

  const base = {
    timestamp: new Date().toISOString(),
    runId,
    benchmarkVersion: BENCHMARK_VERSION,
    scenarioId: scenario.id,
    category: scenario.category,
    provider,
    model,
    sdkVersion: config.dryRun ? "n/a (stub)" : sdkVersion(provider),
    apiMode: config.dryRun ? "deterministic stub (no network call)" : apiMode(provider),
    variant,
    contextFormat: contextText ? format : ("none" as const),
    repetition,
  };

  if (budget.exhausted) {
    return {
      ...base,
      mode: "UNAVAILABLE",
      latencyMs: 0,
      firstTokenMs: null,
      attempts: 0,
      retries: 0,
      ok: false,
      output: "",
      tokens: { retrievedContextTokens, promptTokens, fromProvider: false },
      cost: { estimatedCostUsd: null, rateSource: "unknown_model" },
      failureType: null,
      errorMessage: `skipped: ${budget.reason()}`,
    };
  }

  const adapter = config.dryRun ? StubProvider : PROVIDERS[provider];
  const effectiveModel = config.dryRun ? STUB_MODEL_ID : model;

  let attempts = 0;
  let lastError: unknown;
  const startedAt = Date.now();

  while (attempts <= config.retries) {
    attempts += 1;
    budget.requestsUsed += 1;

    try {
      const response = await withTimeout(
        adapter.generate({
          model: effectiveModel,
          systemInstruction,
          prompt,
          maxOutputTokens: getMaxOutputTokens(),
          responseSchema,
        }),
        config.timeoutMs,
      );

      const usage = response.usage ?? {};
      const cost = computeCost(effectiveModel, usage.inputTokens, usage.outputTokens, rates);
      if (cost.estimatedCostUsd) budget.costUsed += cost.estimatedCostUsd;

      return {
        ...base,
        model: effectiveModel,
        mode: config.dryRun ? "MOCKED" : "LIVE",
        latencyMs: Date.now() - startedAt,
        firstTokenMs: null,
        attempts,
        retries: attempts - 1,
        ok: true,
        output: response.content,
        tokens: {
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          totalTokens: usage.totalTokens,
          reasoningTokens: usage.reasoningTokens,
          cachedInputTokens: usage.cachedInputTokens,
          retrievedContextTokens,
          promptTokens,
          fromProvider: usage.inputTokens !== undefined || usage.outputTokens !== undefined,
        },
        cost,
        failureType: null,
        errorMessage: null,
      };
    } catch (err) {
      lastError = err;
      if (budget.exhausted) break;
    }
  }

  const message = (lastError as Error)?.message ?? "unknown error";
  return {
    ...base,
    model: effectiveModel,
    mode: "UNAVAILABLE",
    latencyMs: Date.now() - startedAt,
    firstTokenMs: null,
    attempts,
    retries: Math.max(0, attempts - 1),
    ok: false,
    output: "",
    tokens: { retrievedContextTokens, promptTokens, fromProvider: false },
    cost: { estimatedCostUsd: null, rateSource: "unknown_model" },
    failureType: classifyApiError(message),
    errorMessage: redact(message),
  };
}

/**
 * Provider errors can echo request headers or URLs. Nothing that could
 * carry a key is allowed into a report or a log line.
 */
export function redact(message: string): string {
  return message
    .replace(/(AIza|sk-)[A-Za-z0-9_\-]{8,}/g, "$1<redacted>")
    .replace(/(key=)[^&\s"']+/gi, "$1<redacted>")
    .replace(/(authorization["':\s]+)(bearer\s+)?[^\s"',}]+/gi, "$1<redacted>");
}

/** Bounded-concurrency map. Keeps a live run from opening 50 sockets at once. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index], index);
    }
  });

  await Promise.all(workers);
  return results;
}

export function newRunId(): string {
  return `run_${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}`;
}
