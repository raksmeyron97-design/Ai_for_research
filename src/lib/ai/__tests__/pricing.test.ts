import { describe, expect, it } from "vitest";
import { computeUsageCost, getModelRate, listVerifiedModels, VERIFIED_RATES } from "../pricing";
import { getModelMatrix } from "../model-config";

/**
 * Phase 16A finding F7. The old table held three placeholder rates that were
 * wrong by 10-30x, and any unknown model was charged at an invented default.
 */
describe("verified rate table", () => {
  it("records a source URL and verification date for every rate", () => {
    for (const [model, rate] of Object.entries(VERIFIED_RATES)) {
      expect(rate.source, `${model} has no source`).toMatch(/^https:\/\//);
      expect(rate.verifiedOn, `${model} has no verification date`).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it("prices every model the app is configured to call", () => {
    const matrix = getModelMatrix();
    const configured = new Set(Object.values(matrix).flatMap((tier) => Object.values(tier)).filter(Boolean));
    const priced = new Set(listVerifiedModels());

    // A configured model with no rate is allowed — it just yields
    // unverified cost — but it should be a deliberate, visible gap.
    const unpriced = [...configured].filter((m) => !priced.has(m));
    expect(unpriced, `configured models with no verified rate: ${unpriced.join(", ")}`).toEqual([
      "gemini-3.1-pro-preview",
    ]);
  });

  it("carries the correct verified Gemini rates", () => {
    expect(VERIFIED_RATES["gemini-3.6-flash"]).toMatchObject({ inputPerMillion: 0.75, outputPerMillion: 3.75 });
    expect(VERIFIED_RATES["gemini-3.5-flash-lite"]).toMatchObject({ inputPerMillion: 0.3, outputPerMillion: 2.5 });
  });

  it("prices the gpt-5.6 alias as the sol variant it routes to", () => {
    expect(VERIFIED_RATES["gpt-5.6"]).toMatchObject({ inputPerMillion: 4.0, outputPerMillion: 20.0 });
    expect(VERIFIED_RATES["gpt-5.6"].inputPerMillion).toBe(VERIFIED_RATES["gpt-5.6-sol"].inputPerMillion);
  });
});

describe("rate expiry", () => {
  it("returns a rate that is still in force", () => {
    expect(getModelRate("gemini-3.6-flash", new Date("2026-09-01T00:00:00Z"))).not.toBeNull();
  });

  it("expires a rate rather than applying a stale price after the published change date", () => {
    // Google publishes an increase for this model on 2027-01-01.
    expect(getModelRate("gemini-3.6-flash", new Date("2027-01-02T00:00:00Z"))).toBeNull();
  });

  it("returns null for a model with no rate on file", () => {
    expect(getModelRate("some-future-model")).toBeNull();
  });
});

describe("computeUsageCost", () => {
  const M = 1_000_000;

  it("marks cost unverified and omits every dollar field for an unpriced model", () => {
    const usage = computeUsageCost("some-future-model", { inputTokens: M, outputTokens: M });
    expect(usage.costConfidence).toBe("unverified");
    expect(usage.totalCostUsd).toBeUndefined();
    expect(usage.inputCostUsd).toBeUndefined();
  });

  it("prices a simple input/output call", () => {
    const usage = computeUsageCost("gemini-3.6-flash", { inputTokens: M, outputTokens: M });
    expect(usage.costConfidence).toBe("verified");
    expect(usage.totalCostUsd).toBeCloseTo(0.75 + 3.75, 10);
  });

  it("adds Gemini thinking tokens to output, since candidatesTokenCount excludes them", () => {
    const withThinking = computeUsageCost("gemini-3.6-flash", {
      inputTokens: 0,
      outputTokens: M,
      reasoningTokens: M,
    });
    // Two million billed output tokens, not one.
    expect(withThinking.totalCostUsd).toBeCloseTo(3.75 * 2, 10);
    expect(withThinking.reasoningCostUsd).toBeCloseTo(3.75, 10);
  });

  it("does NOT double-count OpenAI reasoning tokens, which are already inside output_tokens", () => {
    const withReasoning = computeUsageCost("gpt-5.6", {
      inputTokens: 0,
      outputTokens: M,
      reasoningTokens: M / 2,
    });
    expect(withReasoning.totalCostUsd).toBeCloseTo(20.0, 10);
    expect(withReasoning.reasoningCostUsd).toBe(0);
  });

  it("bills cached input at the discounted rate, as a subset of input", () => {
    const usage = computeUsageCost("gpt-5.6", {
      inputTokens: M,
      outputTokens: 0,
      cachedInputTokens: M / 2,
    });
    // Half at $4.00, half at $0.40 -> $2.00 + $0.20
    expect(usage.totalCostUsd).toBeCloseTo(2.0 + 0.2, 10);
  });

  it("never lets cached tokens exceed total input", () => {
    const usage = computeUsageCost("gpt-5.6", { inputTokens: 100, outputTokens: 0, cachedInputTokens: 999_999 });
    expect(usage.totalCostUsd).toBeCloseTo((100 / M) * 0.4, 12);
  });

  it("treats an expired rate as unverified", () => {
    const usage = computeUsageCost(
      "gemini-3.6-flash",
      { inputTokens: M, outputTokens: 0 },
      new Date("2027-06-01T00:00:00Z"),
    );
    expect(usage.costConfidence).toBe("unverified");
    expect(usage.totalCostUsd).toBeUndefined();
  });

  it("shows the tier-price gap that made F9 expensive", () => {
    const simple = computeUsageCost("gemini-3.5-flash-lite", { inputTokens: M, outputTokens: M }).totalCostUsd!;
    const advanced = computeUsageCost("gpt-5.6", { inputTokens: M, outputTokens: M }).totalCostUsd!;
    expect(advanced / simple).toBeGreaterThan(8);
  });

  it("handles missing token counts without producing NaN", () => {
    const usage = computeUsageCost("gpt-5.6", {});
    expect(usage.totalCostUsd).toBe(0);
    expect(Number.isNaN(usage.totalCostUsd)).toBe(false);
  });
});
