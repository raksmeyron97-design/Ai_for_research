import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AIChunk, AIResponse, TaskClassification } from "../types";

// Only what's needed to isolate the dataset guard from real routing/provider logic.
const providerGenerate = vi.hoisted(() =>
  vi.fn(async (): Promise<AIResponse> => {
    throw new Error("provider.generate should never be called when the dataset guard blocks the request");
  }),
);
const providerStream = vi.hoisted(() =>
  vi.fn(async function* (): AsyncIterable<AIChunk> {
    throw new Error("provider.stream should never be called when the dataset guard blocks the request");
  }),
);

const routerMock = vi.hoisted(() => ({
  resolveProvider: vi.fn(() => ({
    provider: { name: "gemini", generate: providerGenerate, stream: providerStream },
    providerName: "gemini" as const,
    model: "gemini-3.6-flash",
    tier: "standard" as const,
    isFallback: false,
  })),
  resolveFallback: vi.fn(() => null),
  getReviewerProvider: vi.fn(),
}));
vi.mock("../router", () => routerMock);

const classifierMock = vi.hoisted(() => ({
  classifyTask: vi.fn((): TaskClassification => ({
    taskType: "data_analysis" as const,
    complexity: "advanced" as const,
    provider: "gemini" as const,
    needsWeb: false,
    needsDocuments: false,
    needsData: true,
    needsCitations: false,
  })),
  needsVerification: vi.fn(() => false),
}));
vi.mock("../task-classifier", () => classifierMock);

const { AIOrchestrator } = await import("../orchestrator");

beforeEach(() => {
  vi.clearAllMocks();
  routerMock.resolveProvider.mockReturnValue({
    provider: { name: "gemini", generate: providerGenerate, stream: providerStream },
    providerName: "gemini",
    model: "gemini-3.6-flash",
    tier: "standard",
    isFallback: false,
  });
});

const baseRequest = {
  projectId: "11111111-1111-1111-1111-111111111111",
  taskType: "data_analysis" as const,
};

describe("AIOrchestrator dataset guard", () => {
  it("generate() blocks a results/analysis request with no dataSetId, never calling the provider", async () => {
    const orchestrator = new AIOrchestrator();
    const response = await orchestrator.generate(baseRequest);

    expect(providerGenerate).not.toHaveBeenCalled();
    expect(response.content).toContain("Missing:");
    expect(response.warnings?.[0].severity).toBe("critical");
  });

  it("generate() proceeds normally once dataSetId is present", async () => {
    providerGenerate.mockResolvedValueOnce({
      content: "real analysis",
      provider: "gemini",
      model: "gemini-3.6-flash",
    });

    const orchestrator = new AIOrchestrator();
    const response = await orchestrator.generate({ ...baseRequest, dataSetId: "dataset-1" });

    expect(providerGenerate).toHaveBeenCalledTimes(1);
    expect(response.content).toBe("real analysis");
  });

  it("stream() blocks a results/analysis request with no dataSetId, never calling the provider", async () => {
    const orchestrator = new AIOrchestrator();
    const chunks = [];
    for await (const chunk of orchestrator.stream(baseRequest)) chunks.push(chunk);

    expect(providerStream).not.toHaveBeenCalled();
    expect(chunks).toHaveLength(1);
    expect(chunks[0].done).toBe(true);
    expect(chunks[0].delta).toContain("Missing:");
  });

  it("does not block ordinary task types with no dataSetId", async () => {
    classifierMock.classifyTask.mockReturnValueOnce({
      taskType: "chat",
      complexity: "standard",
      provider: "gemini",
      needsWeb: false,
      needsDocuments: false,
      needsData: false,
      needsCitations: false,
    });
    providerGenerate.mockResolvedValueOnce({ content: "hi", provider: "gemini", model: "gemini-3.6-flash" });

    const orchestrator = new AIOrchestrator();
    const response = await orchestrator.generate({ projectId: baseRequest.projectId, taskType: "chat" });

    expect(providerGenerate).toHaveBeenCalledTimes(1);
    expect(response.content).toBe("hi");
  });
});
