import type { SupabaseClient } from "@supabase/supabase-js";
import { AllProvidersFailedError, AIProviderError, withRetry } from "./errors";
import { buildNoDatasetResponse, requiresDataset } from "./integrity-guard";
import { getMaxOutputTokens } from "./model-config";
import { buildPrompt, buildSystemInstruction } from "./prompt-manager";
import { detectPromptInjection } from "./prompt-injection-guard";
import { getReviewerProvider, resolveFallback, resolveProvider, type RoutingDecision } from "./router";
import { getStreamIdleTimeoutMs, withIdleTimeout } from "./stream-guard";
import { classifyTask, needsVerification } from "./task-classifier";
import { buildUsageRecord, recordUsage } from "./token-manager";
import type { AIChunk, AIRequest, AIResponse, TokenUsage } from "./types";

interface OrchestratorOptions {
  userId?: string;
  /** When passed, usage records persist to `ai_usage` (Phase 10) instead of only logging. */
  supabase?: SupabaseClient;
}

async function callProvider(
  decision: RoutingDecision,
  systemInstruction: string,
  prompt: string,
  responseSchema?: Record<string, unknown>,
): Promise<AIResponse> {
  const maxOutputTokens = getMaxOutputTokens();
  return withRetry(
    (signal) =>
      decision.provider.generate({
        model: decision.model,
        systemInstruction,
        prompt,
        maxOutputTokens,
        responseSchema,
        signal,
      }),
    { retries: 1, timeoutMs: 45_000 },
  );
}

/**
 * Central entry point for every AI call in the app (Section 5's
 * "User -> AI API Route -> AI Orchestrator" flow). Classifies the task,
 * routes to a provider, retries/falls back on failure, and always records
 * token usage — success or failure.
 */
export class AIOrchestrator {
  constructor(private readonly options: OrchestratorOptions = {}) {}

  async generate(request: AIRequest): Promise<AIResponse> {
    const classification = classifyTask(request);
    const primary = resolveProvider(classification);

    // Hard block, not a prompt request: a results/analysis task with no
    // dataset attached never reaches a model (Section 19). No usage is
    // recorded — no provider was called, so there's no cost or latency
    // to log.
    if (requiresDataset(request.taskType) && !request.dataSetId) {
      return buildNoDatasetResponse(primary.providerName, primary.model);
    }

    const systemInstruction = buildSystemInstruction(request);
    const prompt = buildPrompt(request);

    const startedAt = Date.now();
    const attempts: AIProviderError[] = [];
    let response: AIResponse | undefined;
    let usedDecision = primary;

    try {
      response = await callProvider(primary, systemInstruction, prompt, request.responseSchema);
    } catch (err) {
      const providerError =
        err instanceof AIProviderError
          ? err
          : new AIProviderError(primary.providerName, (err as Error).message, true, err);
      attempts.push(providerError);

      const fallback = resolveFallback(primary.providerName, classification.complexity);
      if (!fallback) {
        await recordUsage(
          this.options.supabase,
          buildUsageRecord({
            projectId: request.projectId,
            userId: this.options.userId,
            taskType: request.taskType,
            provider: primary.providerName,
            model: primary.model,
            promptText: prompt,
            latencyMs: Date.now() - startedAt,
            success: false,
            fallback: false,
          }),
        );
        throw new AllProvidersFailedError(attempts);
      }

      try {
        response = await callProvider(fallback, systemInstruction, prompt, request.responseSchema);
        usedDecision = fallback;
      } catch (fallbackErr) {
        const fallbackError =
          fallbackErr instanceof AIProviderError
            ? fallbackErr
            : new AIProviderError(fallback.providerName, (fallbackErr as Error).message, true, fallbackErr);
        attempts.push(fallbackError);
        await recordUsage(
          this.options.supabase,
          buildUsageRecord({
            projectId: request.projectId,
            userId: this.options.userId,
            taskType: request.taskType,
            provider: fallback.providerName,
            model: fallback.model,
            promptText: prompt,
            latencyMs: Date.now() - startedAt,
            success: false,
            fallback: true,
          }),
        );
        throw new AllProvidersFailedError(attempts);
      }
    }

    await recordUsage(
      this.options.supabase,
      buildUsageRecord({
        projectId: request.projectId,
        userId: this.options.userId,
        taskType: request.taskType,
        provider: usedDecision.providerName,
        model: usedDecision.model,
        usage: response.usage,
        promptText: prompt,
        outputText: response.content,
        latencyMs: Date.now() - startedAt,
        success: true,
        fallback: usedDecision.isFallback,
      }),
    );

    if (needsVerification(request, classification)) {
      response = await this.attachVerification(request, response);
    }

    const injectionWarning = request.context ? detectPromptInjection(request.context) : null;
    if (injectionWarning) {
      response = { ...response, warnings: [...(response.warnings ?? []), injectionWarning] };
    }

    return response;
  }

  /**
   * Second-model review pass (Section 6). Only runs for high-risk tasks or
   * when explicitly requested — never on every call. The reviewer's notes
   * are attached as unstructured text for now; Phase 5 (Research
   * Intelligence) upgrades this to structured ResearchValidationIssue[].
   */
  private async attachVerification(request: AIRequest, primary: AIResponse): Promise<AIResponse> {
    const reviewer = getReviewerProvider();
    if (reviewer.providerName === primary.provider) return primary;

    try {
      const reviewPrompt = `Review the following AI-generated research content for unsupported claims, fabricated citations/statistics, and alignment issues. Be concise.\n\n---\n${primary.content}\n---`;
      const reviewResponse = await callProvider(
        reviewer,
        buildSystemInstruction({ ...request, taskType: "quality_check" }),
        reviewPrompt,
      );

      return {
        ...primary,
        structuredData: {
          verification: {
            reviewerProvider: reviewer.providerName,
            reviewerModel: reviewer.model,
            notes: reviewResponse.content,
          },
        },
      };
    } catch {
      // Verification is best-effort: never fail the primary response because the reviewer call failed.
      return primary;
    }
  }

  async *stream(request: AIRequest): AsyncIterable<AIChunk> {
    const classification = classifyTask(request);
    const decision = resolveProvider(classification);

    if (requiresDataset(request.taskType) && !request.dataSetId) {
      yield { delta: buildNoDatasetResponse(decision.providerName, decision.model).content, done: true };
      return;
    }

    if (!decision.provider.stream) {
      const response = await this.generate(request);
      yield { delta: response.content, done: true };
      return;
    }

    const systemInstruction = buildSystemInstruction(request);
    const prompt = buildPrompt(request);
    const startedAt = Date.now();

    // Tracked across the primary attempt so the fallback decision can be
    // made on fact rather than hope: once a byte has reached the client we
    // cannot restart on another provider without duplicating output.
    const state = { outputText: "", usage: undefined as TokenUsage | undefined, emitted: false };

    try {
      yield* this.streamFrom(decision, systemInstruction, prompt, state);
    } catch (primaryError) {
      const fallback = state.emitted ? null : resolveFallback(decision.providerName, classification.complexity);

      if (!fallback) {
        // Either output already reached the client, or there is nowhere to
        // fall back to. Record the failure — never as a partial success —
        // and let the caller see the real error.
        await this.recordStreamUsage(request, decision, prompt, state, startedAt, false);
        throw primaryError;
      }

      // Nothing was emitted, so switching providers cannot duplicate a
      // chunk. The failed attempt is still recorded: it consumed tokens.
      await this.recordStreamUsage(request, decision, prompt, state, startedAt, false);

      const fallbackState = { outputText: "", usage: undefined as TokenUsage | undefined, emitted: false };
      const fallbackStartedAt = Date.now();
      try {
        yield* this.streamFrom(fallback, systemInstruction, prompt, fallbackState);
      } catch (fallbackError) {
        await this.recordStreamUsage(request, fallback, prompt, fallbackState, fallbackStartedAt, false);
        throw fallbackError;
      }
      await this.recordStreamUsage(request, fallback, prompt, fallbackState, fallbackStartedAt, true);
      return;
    }

    await this.recordStreamUsage(request, decision, prompt, state, startedAt, true);
  }

  /**
   * One streaming attempt against one provider, guarded by an idle-gap
   * timeout. The AbortController is what makes the timeout real: both
   * adapters forward the signal to their SDK, so a stall cancels the
   * in-flight request instead of abandoning it.
   */
  private async *streamFrom(
    decision: RoutingDecision,
    systemInstruction: string,
    prompt: string,
    state: { outputText: string; usage: TokenUsage | undefined; emitted: boolean },
  ): AsyncIterable<AIChunk> {
    const controller = new AbortController();

    const source = decision.provider.stream!({
      model: decision.model,
      systemInstruction,
      prompt,
      maxOutputTokens: getMaxOutputTokens(),
      signal: controller.signal,
    });

    try {
      for await (const chunk of withIdleTimeout(source, {
        idleMs: getStreamIdleTimeoutMs(),
        provider: decision.providerName,
        controller,
      })) {
        state.outputText += chunk.delta;
        state.usage = chunk.usage ?? state.usage;
        if (chunk.delta) state.emitted = true;
        yield chunk;
      }
    } finally {
      // Covers the consumer abandoning the stream mid-iteration, which
      // otherwise leaves the provider connection open.
      controller.abort();
    }
  }

  private async recordStreamUsage(
    request: AIRequest,
    decision: RoutingDecision,
    prompt: string,
    state: { outputText: string; usage: TokenUsage | undefined },
    startedAt: number,
    success: boolean,
  ): Promise<void> {
    await recordUsage(
      this.options.supabase,
      buildUsageRecord({
        projectId: request.projectId,
        userId: this.options.userId,
        taskType: request.taskType,
        provider: decision.providerName,
        model: decision.model,
        usage: state.usage,
        promptText: prompt,
        outputText: state.outputText,
        latencyMs: Date.now() - startedAt,
        success,
        fallback: decision.isFallback,
      }),
    );
  }
}
