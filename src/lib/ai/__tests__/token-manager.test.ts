import { describe, expect, it } from "vitest";
import { buildUsageRecord, calculateCost, estimateTokens } from "../token-manager";

describe("estimateTokens", () => {
  it("estimates roughly 4 characters per token", () => {
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });

  it("never returns zero for non-empty text", () => {
    expect(estimateTokens("hi")).toBeGreaterThan(0);
  });
});

describe("calculateCost", () => {
  it("returns 0 for a request with no tokens", () => {
    expect(calculateCost("gemini-3.6-flash", {})).toBe(0);
  });

  it("scales linearly with token count for a known model", () => {
    const small = calculateCost("gemini-3.6-flash", { inputTokens: 1_000_000, outputTokens: 0 });
    const large = calculateCost("gemini-3.6-flash", { inputTokens: 2_000_000, outputTokens: 0 });
    expect(large).toBeCloseTo(small * 2);
  });

  it("falls back to the default rate for an unrecognized model", () => {
    const cost = calculateCost("some-future-model", { inputTokens: 1_000_000, outputTokens: 0 });
    expect(cost).toBeGreaterThan(0);
  });
});

describe("buildUsageRecord", () => {
  it("prefers provider-reported usage over estimation", () => {
    const record = buildUsageRecord({
      projectId: "p1",
      taskType: "chat",
      provider: "gemini",
      model: "gemini-3.6-flash",
      usage: { inputTokens: 10, outputTokens: 20 },
      promptText: "x".repeat(4000),
      outputText: "y".repeat(4000),
      latencyMs: 100,
      success: true,
      fallback: false,
    });
    expect(record.inputTokens).toBe(10);
    expect(record.outputTokens).toBe(20);
  });

  it("estimates from text when the provider reports no usage", () => {
    const record = buildUsageRecord({
      projectId: "p1",
      taskType: "chat",
      provider: "openai",
      model: "gpt-5.6",
      promptText: "a".repeat(400),
      outputText: "b".repeat(400),
      latencyMs: 50,
      success: true,
      fallback: false,
    });
    expect(record.inputTokens).toBe(100);
    expect(record.outputTokens).toBe(100);
  });
});
