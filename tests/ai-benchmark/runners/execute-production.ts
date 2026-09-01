import { AIOrchestrator } from "@/lib/ai/orchestrator";
import { classifyTask } from "@/lib/ai/task-classifier";
import { resolveProvider } from "@/lib/ai/router";
import { resetModelConfigCache } from "@/lib/ai/model-config";
import { verifyCitationsInText } from "@/lib/ai/integrity-guard";
import { buildPrompt, buildSystemInstruction } from "@/lib/ai/prompt-manager";
import { estimateTokens } from "@/lib/ai/token-manager";
import {
  ALIGNMENT_RESPONSE_JSON_SCHEMA,
  QUALITY_CHECK_RESPONSE_JSON_SCHEMA,
  QUESTIONNAIRE_RESPONSE_JSON_SCHEMA,
} from "@/lib/ai/schemas";
import type { AIRequest, ProviderName, ResearchWarning } from "@/lib/ai/types";
import type { BenchmarkConfig } from "../config";
import { buildScenarioContext } from "../fixtures/context";
import { classifyApiError } from "../failure-taxonomy";
import {
  BENCHMARK_VERSION,
  type BenchmarkScenario,
  type ExecutionRecord,
  type TestGroup,
  type Variant,
} from "../types";
import { createBenchmarkSupabase } from "./benchmark-supabase";
import { withCallCaptureSettled, type ProviderCall } from "./instrumented-providers";
import { apiMode, sdkVersion } from "./preflight";
import type { RunBudget } from "./execute";
import { redact, withTimeout } from "./execute";
import { contextFormatFor } from "./variants";

const SCHEMAS = {
  questionnaire: QUESTIONNAIRE_RESPONSE_JSON_SCHEMA,
  quality_check: QUALITY_CHECK_RESPONSE_JSON_SCHEMA,
  alignment: ALIGNMENT_RESPONSE_JSON_SCHEMA,
} as const;

/**
 * Phase 16B §7: benchmark the system, not the adapters.
 *
 * The previous executor called `provider.generate()` directly. That measured
 * the models but skipped everything the application actually does around
 * them — task classification, tier routing, the dataset guard, retry and
 * cross-provider fallback, usage and cost accounting, the prompt-injection
 * guard, and citation verification. A benchmark that skips those cannot
 * answer "is the production AI path good enough", which is the question.
 *
 * This executor drives `AIOrchestrator.generate()` and then runs the same
 * citation verification the API routes run, so a scored response is the
 * response a researcher would have received.
 *
 * Provider selection is done the way the application does it, by
 * enabling/disabling a provider for the group and letting `resolveProvider`
 * choose the tier's model — not by handing the orchestrator a model id. That
 * keeps the router in the measured path instead of stubbing it out.
 */
export interface ProductionExecuteParams {
  scenario: BenchmarkScenario;
  group: TestGroup;
  variant: Variant;
  repetition: number;
  runId: string;
  config: BenchmarkConfig;
  budget: RunBudget;
}

/**
 * Applies the group's provider policy through the real feature flags. Groups
 * run sequentially precisely because this is process-global: two groups in
 * flight at once would race on the same env.
 */
export function applyGroupRouting(group: TestGroup): () => void {
  const previous = {
    gemini: process.env.AI_ENABLE_GEMINI,
    openai: process.env.AI_ENABLE_OPENAI,
  };

  delete process.env.AI_ENABLE_GEMINI;
  delete process.env.AI_ENABLE_OPENAI;
  if (group === "gemini") process.env.AI_ENABLE_OPENAI = "false";
  if (group === "openai") process.env.AI_ENABLE_GEMINI = "false";
  resetModelConfigCache();

  return () => {
    if (previous.gemini === undefined) delete process.env.AI_ENABLE_GEMINI;
    else process.env.AI_ENABLE_GEMINI = previous.gemini;
    if (previous.openai === undefined) delete process.env.AI_ENABLE_OPENAI;
    else process.env.AI_ENABLE_OPENAI = previous.openai;
    resetModelConfigCache();
  };
}

function toWarnings(warnings: ResearchWarning[] | undefined) {
  return (warnings ?? []).map((w) => ({
    severity: w.severity,
    category: w.category,
    message: w.message,
  }));
}

export async function executeScenarioViaProduction(
  params: ProductionExecuteParams,
): Promise<ExecutionRecord> {
  const { scenario, group, variant, repetition, runId, config, budget } = params;

  const { text: contextText } = buildScenarioContext(scenario, contextFormatFor(variant));

  const request: AIRequest = {
    projectId: "00000000-0000-0000-0000-000000000000",
    taskType: scenario.task,
    message: scenario.input,
    language: scenario.language === "km" ? "km" : "en",
    context: contextText || undefined,
    // The dataset guard fires on results/analysis tasks with no dataSetId.
    // Scenarios that are *about* that guard deliberately leave it unset.
    ...(scenario.dataSetId ? { dataSetId: scenario.dataSetId } : {}),
    ...(scenario.expect.schema ? { responseSchema: SCHEMAS[scenario.expect.schema] } : {}),
  };

  // Classification and routing are recorded even when the group pins a
  // provider: what the router *chose* is itself a measurement, and the
  // `routed` group is scored on it.
  const classification = classifyTask(request);
  const decision = resolveProvider(classification);

  const promptTokens = estimateTokens(`${buildSystemInstruction(request)}\n${buildPrompt(request)}`);

  const base = {
    timestamp: new Date().toISOString(),
    runId,
    benchmarkVersion: BENCHMARK_VERSION,
    scenarioId: scenario.id,
    category: scenario.category,
    provider: decision.providerName as ProviderName,
    model: decision.model,
    sdkVersion: config.dryRun ? "n/a (stub)" : sdkVersion(decision.providerName),
    apiMode: config.dryRun
      ? "deterministic stub via AIOrchestrator (no network call)"
      : `${apiMode(decision.providerName)} via AIOrchestrator`,
    variant,
    group,
    tier: classification.complexity,
    contextFormat: contextText ? contextFormatFor(variant) : ("none" as const),
    repetition,
  };

  const emptyTokens = { retrievedContextTokens: estimateTokens(contextText), promptTokens, fromProvider: false };

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
      tokens: emptyTokens,
      cost: { estimatedCostUsd: null, rateSource: "unknown_model" },
      blockedByDatasetGuard: false,
      productionWarnings: [],
      providerCalls: 0,
      costConfidence: "unverified",
      failureType: null,
      errorMessage: `skipped: ${budget.reason()}`,
    };
  }

  const { client: supabase, usageRows } = createBenchmarkSupabase();
  const startedAt = Date.now();

  // Provider instrumentation is installed once for the whole run; this scope
  // attributes the calls made inside it — including the orchestrator's own
  // retries, fallbacks and reviewer pass — to this scenario.
  const captured = await withCallCaptureSettled(async () => {
    const orchestrator = new AIOrchestrator({ supabase: supabase as never });
    // Backstop only. The orchestrator has its own timeout, retry and
    // fallback; this exists so a hang *inside* that machinery cannot stall
    // the whole run, which is why it is set well above production's budget.
    const response = await withTimeout(orchestrator.generate(request), config.timeoutMs);

    // The same verification /api/ai/chat and /api/ai/generate run. Without
    // it the benchmark would score output the application would have
    // annotated, which is not what a researcher sees.
    let citationWarnings: ResearchWarning[] = [];
    try {
      citationWarnings = await verifyCitationsInText(
        supabase as never,
        request.projectId,
        response.content,
      );
    } catch {
      // Verification failure is not a scenario failure.
    }
    return { response, citationWarnings };
  });

  const providerCalls: ProviderCall[] = captured.calls;

  if (captured.error) {
    const message = (captured.error as Error)?.message ?? "unknown error";
    const usage = usageRows.at(-1);
    return {
      ...base,
      mode: "UNAVAILABLE",
      latencyMs: Date.now() - startedAt,
      firstTokenMs: null,
      attempts: Math.max(1, providerCalls.length),
      retries: Math.max(0, providerCalls.length - 1),
      ok: false,
      output: "",
      tokens: {
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
        retrievedContextTokens: emptyTokens.retrievedContextTokens,
        promptTokens,
        fromProvider: usage?.tokens_measured ?? false,
      },
      cost: { estimatedCostUsd: null, rateSource: "unknown_model" },
      blockedByDatasetGuard: false,
      productionWarnings: [],
      providerCalls: providerCalls.length,
      costConfidence: usage?.cost_confidence ?? "unverified",
      failureType: classifyApiError(message),
      errorMessage: redact(message),
    };
  }

  {
    const { response, citationWarnings } = captured.result!;

    // No provider call at all means the orchestrator's dataset guard answered
    // before anything reached a model — the correct outcome for §15 Test A.
    const blockedByDatasetGuard = providerCalls.length === 0;

    // A genuine runtime fallback is a *failed* call followed by a successful
    // one on another provider. `decision.isFallback` alone is not that: in a
    // pinned group the other provider is disabled, so the router legitimately
    // flags every choice as a fallback. Reporting those as DEGRADED would
    // make an entire healthy group look impaired.
    const recoveredFromFailure =
      providerCalls.some((c) => !c.ok) && providerCalls.some((c) => c.ok);

    const usage = usageRows.at(-1);
    const cost = usage
      ? {
          estimatedCostUsd: usage.cost_confidence === "verified" ? usage.estimated_cost_usd : null,
          rateSource:
            usage.cost_confidence === "verified"
              ? ("verified_app_pricing" as const)
              : ("unknown_model" as const),
        }
      : { estimatedCostUsd: null, rateSource: "unknown_model" as const };

    return {
      ...base,
      // The orchestrator may have fallen back; report what actually ran.
      provider: (usage?.provider as ProviderName) ?? base.provider,
      model: usage?.model ?? base.model,
      mode: config.dryRun ? "MOCKED" : recoveredFromFailure ? "DEGRADED" : "LIVE",
      latencyMs: Date.now() - startedAt,
      firstTokenMs: null,
      attempts: Math.max(1, providerCalls.length),
      retries: Math.max(0, providerCalls.filter((c) => !c.ok).length),
      ok: true,
      output: response.content,
      tokens: {
        inputTokens: usage?.input_tokens,
        outputTokens: usage?.output_tokens,
        totalTokens: usage ? usage.input_tokens + usage.output_tokens : undefined,
        retrievedContextTokens: emptyTokens.retrievedContextTokens,
        promptTokens,
        fromProvider: usage?.tokens_measured ?? false,
      },
      cost,
      blockedByDatasetGuard,
      productionWarnings: [...toWarnings(response.warnings), ...toWarnings(citationWarnings)],
      providerCalls: providerCalls.length,
      costConfidence: usage?.cost_confidence ?? "unverified",
      failureType: null,
      errorMessage: null,
    };
  }
}
