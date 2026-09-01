import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AIConfigError } from "../errors";
import { resetModelConfigCache } from "../model-config";
import { resolveFallback, resolveProvider } from "../router";
import type { ModelTier, ProviderName, TaskClassification } from "../types";

/**
 * Phase 16A finding F9. `resolveFallback` had only one model per tier, so
 * when the other provider was not that tier's owner it fell through to
 * `getTierConfig("advanced")`. A failed `simple` task landed on the reasoning
 * model — with verified pricing, gemini-3.5-flash-lite ($0.30/$2.50 per 1M)
 * failing over to gpt-5.6-sol ($4.00/$20.00).
 */
const MODEL_ENV = [
  "GEMINI_FAST_MODEL", "OPENAI_FAST_MODEL",
  "GEMINI_STANDARD_MODEL", "OPENAI_STANDARD_MODEL",
  "GEMINI_ADVANCED_MODEL", "OPENAI_REASONING_MODEL",
  "GEMINI_REVIEWER_MODEL", "OPENAI_REVIEWER_MODEL",
  "AI_ENABLE_GEMINI", "AI_ENABLE_OPENAI",
];

function classification(tier: ModelTier, provider: ProviderName): TaskClassification {
  return { taskType: "chat", complexity: tier, provider };
}

beforeEach(() => {
  for (const key of MODEL_ENV) delete process.env[key];
  resetModelConfigCache();
});

afterEach(() => {
  for (const key of MODEL_ENV) delete process.env[key];
  resetModelConfigCache();
});

describe("tier-preserving fallback", () => {
  const TIERS: ModelTier[] = ["simple", "standard", "advanced", "reviewer"];

  it.each(TIERS)("gemini → openai keeps the %s tier", (tier) => {
    process.env.GEMINI_FAST_MODEL = "g-simple";
    process.env.OPENAI_FAST_MODEL = "o-simple";
    process.env.GEMINI_STANDARD_MODEL = "g-standard";
    process.env.OPENAI_STANDARD_MODEL = "o-standard";
    process.env.GEMINI_ADVANCED_MODEL = "g-advanced";
    process.env.OPENAI_REASONING_MODEL = "o-advanced";
    process.env.GEMINI_REVIEWER_MODEL = "g-reviewer";
    process.env.OPENAI_REVIEWER_MODEL = "o-reviewer";
    resetModelConfigCache();

    const decision = resolveFallback("gemini", tier);

    expect(decision).not.toBeNull();
    expect(decision!.providerName).toBe("openai");
    expect(decision!.tier).toBe(tier);
    expect(decision!.model).toBe(`o-${tier}`);
    expect(decision!.isFallback).toBe(true);
  });

  it.each(TIERS)("openai → gemini keeps the %s tier", (tier) => {
    process.env.GEMINI_FAST_MODEL = "g-simple";
    process.env.GEMINI_STANDARD_MODEL = "g-standard";
    process.env.GEMINI_ADVANCED_MODEL = "g-advanced";
    process.env.GEMINI_REVIEWER_MODEL = "g-reviewer";
    resetModelConfigCache();

    const decision = resolveFallback("openai", tier);

    expect(decision).not.toBeNull();
    expect(decision!.providerName).toBe("gemini");
    expect(decision!.tier).toBe(tier);
    expect(decision!.model).toBe(`g-${tier}`);
  });

  it("never routes a simple task to the advanced model — the F9 regression", () => {
    resetModelConfigCache();
    const advanced = resolveFallback("gemini", "advanced")!;
    const simple = resolveFallback("gemini", "simple")!;

    expect(simple.model).not.toBe(advanced.model);
    // Concretely: the default simple fallback must not be the flagship.
    expect(simple.model).toBe("gpt-5.6-luna");
    expect(advanced.model).toBe("gpt-5.6");
  });

  it("uses defaults that are cheaper at lower tiers", () => {
    resetModelConfigCache();
    expect(resolveFallback("gemini", "simple")!.model).toBe("gpt-5.6-luna");
    expect(resolveFallback("gemini", "standard")!.model).toBe("gpt-5.4-mini");
  });
});

describe("fallback availability", () => {
  it("returns null when the other provider is disabled", () => {
    process.env.AI_ENABLE_OPENAI = "false";
    resetModelConfigCache();
    expect(resolveFallback("gemini", "standard")).toBeNull();
  });

  it("returns null when the other provider has no model at this tier", () => {
    process.env.OPENAI_FAST_MODEL = "";
    resetModelConfigCache();
    // Blanking the cell is how a deployment says "nothing suitable here";
    // substituting a differently-priced model would defeat the point of F9.
    expect(resolveFallback("gemini", "simple")).toBeNull();
  });

  it("does not offer a fallback back to the provider that just failed", () => {
    resetModelConfigCache();
    expect(resolveFallback("gemini", "standard")!.providerName).toBe("openai");
    expect(resolveFallback("openai", "standard")!.providerName).toBe("gemini");
  });

  it("cannot chain: the fallback of a fallback returns to the original, and callers only try once", () => {
    resetModelConfigCache();
    const first = resolveFallback("gemini", "standard")!;
    const second = resolveFallback(first.providerName, "standard")!;
    // Two providers means the graph is a 2-cycle; the orchestrator attempts a
    // single fallback, so there is no loop to enter.
    expect(second.providerName).toBe("gemini");
  });
});

describe("resolveProvider with a disabled primary", () => {
  it("keeps the tier when falling back to the enabled provider", () => {
    process.env.AI_ENABLE_GEMINI = "false";
    process.env.OPENAI_FAST_MODEL = "o-simple";
    resetModelConfigCache();

    const decision = resolveProvider(classification("simple", "gemini"));
    expect(decision.providerName).toBe("openai");
    expect(decision.tier).toBe("simple");
    expect(decision.model).toBe("o-simple");
    expect(decision.isFallback).toBe(true);
  });

  it("throws when neither provider is enabled", () => {
    process.env.AI_ENABLE_GEMINI = "false";
    process.env.AI_ENABLE_OPENAI = "false";
    resetModelConfigCache();
    expect(() => resolveProvider(classification("standard", "gemini"))).toThrow(AIConfigError);
  });

  it("throws a configuration error, rather than mis-routing, when the enabled provider has no model at this tier", () => {
    process.env.AI_ENABLE_GEMINI = "false";
    process.env.OPENAI_FAST_MODEL = "";
    resetModelConfigCache();
    expect(() => resolveProvider(classification("simple", "gemini"))).toThrow(AIConfigError);
  });

  it("uses the primary without a fallback flag when it is enabled", () => {
    resetModelConfigCache();
    const decision = resolveProvider(classification("standard", "gemini"));
    expect(decision.providerName).toBe("gemini");
    expect(decision.isFallback).toBe(false);
  });
});
