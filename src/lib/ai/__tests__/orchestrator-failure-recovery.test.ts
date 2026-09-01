import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIResponse, TaskClassification } from "../types";

const providerGenerate = vi.hoisted(() => vi.fn());
const fallbackGenerate = vi.hoisted(() => vi.fn());

const routerMock = vi.hoisted(() => ({
  resolveProvider: vi.fn(() => ({
    provider: { name: "gemini", generate: providerGenerate },
    providerName: "gemini" as const,
    model: "gemini-3.6-flash",
    tier: "standard" as const,
    isFallback: false,
  })),
  resolveFallback: vi.fn(),
  getReviewerProvider: vi.fn(),
}));
vi.mock("../router", () => routerMock);

const classifierMock = vi.hoisted(() => ({
  classifyTask: vi.fn(
    (): TaskClassification => ({
      taskType: "chat" as const,
      complexity: "standard" as const,
      provider: "gemini" as const,
    }),
  ),
  needsVerification: vi.fn(() => false),
}));
vi.mock("../task-classifier", () => classifierMock);

const { AIOrchestrator } = await import("../orchestrator");
const { AllProvidersFailedError } = await import("../errors");

const baseRequest = {
  projectId: "11111111-1111-1111-1111-111111111111",
  taskType: "chat" as const,
};

beforeEach(() => {
  vi.clearAllMocks();
  routerMock.resolveProvider.mockReturnValue({
    provider: { name: "gemini", generate: providerGenerate },
    providerName: "gemini",
    model: "gemini-3.6-flash",
    tier: "standard",
    isFallback: false,
  });
  routerMock.resolveFallback.mockReturnValue(null);
});

/**
 * `mockRejectedValue` (persistent), not `mockRejectedValueOnce`, is used
 * throughout below for "this provider is down": `callProvider()` retries
 * once internally (errors.ts's `withRetry`, `retries: 1`), so a single
 * queued rejection would let the retry attempt silently "succeed" with an
 * unmocked `undefined` response instead of representing a real, total
 * outage of that provider.
 */
describe("AIOrchestrator — provider outage recovery (Phase 15 §5)", () => {
  it("throws AllProvidersFailedError immediately when the primary fails and no fallback exists", async () => {
    providerGenerate.mockRejectedValue(new Error("gemini unavailable"));
    const orchestrator = new AIOrchestrator();
    await expect(orchestrator.generate(baseRequest)).rejects.toThrow(AllProvidersFailedError);
  });

  it("falls back to a second provider and succeeds when only the primary is down", async () => {
    providerGenerate.mockRejectedValue(new Error("gemini unavailable"));
    routerMock.resolveFallback.mockReturnValueOnce({
      provider: { name: "openai", generate: fallbackGenerate },
      providerName: "openai",
      model: "gpt-5.6",
      tier: "standard",
      isFallback: true,
    });
    fallbackGenerate.mockResolvedValueOnce({
      content: "answer from fallback",
      provider: "openai",
      model: "gpt-5.6",
    } satisfies AIResponse);

    const orchestrator = new AIOrchestrator();
    const response = await orchestrator.generate(baseRequest);
    expect(response.content).toBe("answer from fallback");
  });

  it("throws AllProvidersFailedError when BOTH the primary and the fallback are down — the 'both providers unavailable' case", async () => {
    providerGenerate.mockRejectedValue(new Error("gemini unavailable"));
    routerMock.resolveFallback.mockReturnValueOnce({
      provider: { name: "openai", generate: fallbackGenerate },
      providerName: "openai",
      model: "gpt-5.6",
      tier: "standard",
      isFallback: true,
    });
    fallbackGenerate.mockRejectedValue(new Error("openai unavailable"));

    const orchestrator = new AIOrchestrator();
    const error = await orchestrator.generate(baseRequest).catch((e) => e);
    expect(error).toBeInstanceOf(AllProvidersFailedError);
    // Both attempts should be recorded on the error, not just the last one —
    // an admin debugging "both providers unavailable" needs to see that
    // both were actually tried, not just the final failure.
    expect(error.attempts).toHaveLength(2);
  });

  it("never lets a raw provider error escape uncaught — it is always wrapped in AllProvidersFailedError", async () => {
    providerGenerate.mockRejectedValue(new TypeError("unexpected shape from provider SDK"));
    const orchestrator = new AIOrchestrator();
    const error = await orchestrator.generate(baseRequest).catch((e) => e);
    expect(error).toBeInstanceOf(AllProvidersFailedError);
    expect(error).not.toBeInstanceOf(TypeError);
  });
});
