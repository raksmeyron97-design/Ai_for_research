import { AllProvidersFailedError, AIProviderError, withRetry } from "./errors";
import { buildNoDatasetResponse, requiresDataset } from "./integrity-guard";
import { getMaxOutputTokens } from "./model-config";
import { buildPrompt, buildSystemInstruction } from "./prompt-manager";
import { getReviewerProvider, resolveFallback, resolveProvider, type RoutingDecision } from "./router";
import { classifyTask, needsVerification } from "./task-classifier";
import { buildUsageRecord, recordUsage } from "./token-manager";
import type { AIChunk, AIRequest, AIResponse } from "./types";

interface OrchestratorOptions {
  userId?: string;
}

async function callProvider(
  decision: RoutingDecision,
  systemInstruction: string,
  prompt: string,
  responseSchema?: Record<string, unknown>,
): Promise<AIResponse> {
  const maxOutputTokens = getMaxOutputTokens();
  return withRetry(
    () =>
      decision.provider.generate({
        model: decision.model,
        systemInstruction,
        prompt,
        maxOutputTokens,
        responseSchema,
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
        recordUsage(
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
        recordUsage(
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

    recordUsage(
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
    let outputText = "";

    try {
      for await (const chunk of decision.provider.stream({
        model: decision.model,
        systemInstruction,
        prompt,
        maxOutputTokens: getMaxOutputTokens(),
      })) {
        outputText += chunk.delta;
        yield chunk;
      }
      recordUsage(
        buildUsageRecord({
          projectId: request.projectId,
          userId: this.options.userId,
          taskType: request.taskType,
          provider: decision.providerName,
          model: decision.model,
          promptText: prompt,
          outputText,
          latencyMs: Date.now() - startedAt,
          success: true,
          fallback: decision.isFallback,
        }),
      );
    } catch (err) {
      recordUsage(
        buildUsageRecord({
          projectId: request.projectId,
          userId: this.options.userId,
          taskType: request.taskType,
          provider: decision.providerName,
          model: decision.model,
          promptText: prompt,
          latencyMs: Date.now() - startedAt,
          success: false,
          fallback: decision.isFallback,
        }),
      );
      throw err;
    }
  }
}
