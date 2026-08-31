import { afterEach, describe, expect, it } from "vitest";
import { AIConfigError } from "../errors";
import { getReviewerProvider, resolveFallback, resolveProvider } from "../router";
import type { TaskClassification } from "../types";

function classification(overrides: Partial<TaskClassification> = {}): TaskClassification {
  return {
    taskType: "chat",
    complexity: "standard",
    provider: "gemini",
    needsWeb: false,
    needsDocuments: false,
    needsData: false,
    needsCitations: false,
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.AI_ENABLE_GEMINI;
  delete process.env.AI_ENABLE_OPENAI;
});

describe("resolveProvider", () => {
  it("uses the tier's configured provider when it is enabled", () => {
    const decision = resolveProvider(classification({ complexity: "standard" }));
    expect(decision.providerName).toBe("gemini");
    expect(decision.isFallback).toBe(false);
  });

  it("falls back to the other provider when the primary is disabled", () => {
    process.env.AI_ENABLE_GEMINI = "false";
    const decision = resolveProvider(classification({ complexity: "standard" }));
    expect(decision.providerName).toBe("openai");
    expect(decision.isFallback).toBe(true);
  });

  it("throws AIConfigError when both providers are disabled", () => {
    process.env.AI_ENABLE_GEMINI = "false";
    process.env.AI_ENABLE_OPENAI = "false";
    expect(() => resolveProvider(classification())).toThrow(AIConfigError);
  });
});

describe("resolveFallback", () => {
  it("returns the other provider when it is enabled", () => {
    const decision = resolveFallback("gemini", "standard");
    expect(decision?.providerName).toBe("openai");
    expect(decision?.isFallback).toBe(true);
  });

  it("returns null when the other provider is disabled", () => {
    process.env.AI_ENABLE_OPENAI = "false";
    const decision = resolveFallback("gemini", "standard");
    expect(decision).toBeNull();
  });
});

describe("getReviewerProvider", () => {
  it("resolves to the configured reviewer tier", () => {
    const decision = getReviewerProvider();
    expect(decision.tier).toBe("reviewer");
    expect(decision.model.length).toBeGreaterThan(0);
  });
});
