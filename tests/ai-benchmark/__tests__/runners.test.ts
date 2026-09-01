import { describe, expect, it } from "vitest";
import { computeCost, loadConfig } from "../config";
import { classifyApiError, classifyResult } from "../failure-taxonomy";
import { RunBudget, mapWithConcurrency, redact } from "../runners/execute";
import { StubProvider, STUB_MODEL_ID } from "../runners/stub-provider";
import { apiMode, sdkVersion } from "../runners/preflight";
import { QUALITY_CHECK_RESPONSE_JSON_SCHEMA } from "@/lib/ai/schemas";
import type { BenchmarkConfig } from "../config";
import type { BenchmarkScenario, ExecutionRecord, ScenarioResult } from "../types";

function config(overrides: Partial<BenchmarkConfig> = {}): BenchmarkConfig {
  return { ...loadConfig(), ...overrides };
}

describe("run budget", () => {
  it("stops the run at the request ceiling", () => {
    const budget = new RunBudget(config({ maxRequests: 2, maxCostUsd: null }));
    expect(budget.exhausted).toBe(false);
    budget.requestsUsed = 2;
    expect(budget.exhausted).toBe(true);
    expect(budget.reason()).toContain("request ceiling");
  });

  it("stops the run at the cost ceiling", () => {
    const budget = new RunBudget(config({ maxRequests: 1000, maxCostUsd: 0.5 }));
    budget.costUsed = 0.51;
    expect(budget.exhausted).toBe(true);
    expect(budget.reason()).toContain("cost ceiling");
  });

  it("stops the run on cancellation", () => {
    const budget = new RunBudget(config({ maxRequests: 1000, maxCostUsd: null }));
    budget.cancel();
    expect(budget.exhausted).toBe(true);
    expect(budget.reason()).toBe("run cancelled");
  });
});

describe("cost accounting", () => {
  it("refuses to report a cost without a verified rate file", () => {
    const cost = computeCost("gemini-x", 1000, 500, null);
    expect(cost.estimatedCostUsd).toBeNull();
    expect(cost.rateSource).toBe("unverified_placeholder");
  });

  it("computes cost from a verified rate file", () => {
    const rates = { "model-x": { inputPerMillion: 1, outputPerMillion: 4 } };
    const cost = computeCost("model-x", 1_000_000, 1_000_000, rates);
    expect(cost.estimatedCostUsd).toBeCloseTo(5, 10);
    expect(cost.rateSource).toBe("verified_rate_file");
  });

  it("marks a model absent from the rate file rather than guessing", () => {
    const cost = computeCost("model-y", 100, 100, { "model-x": { inputPerMillion: 1, outputPerMillion: 1 } });
    expect(cost.estimatedCostUsd).toBeNull();
    expect(cost.rateSource).toBe("unknown_model");
  });

  it("reports no cost when the provider returned no usage at all", () => {
    expect(computeCost("model-x", undefined, undefined, null).estimatedCostUsd).toBeNull();
  });
});

describe("secret redaction", () => {
  it("redacts a Google API key echoed in a provider error", () => {
    const out = redact("request failed: key=AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345 rejected");
    expect(out).not.toContain("AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345");
    expect(out).toContain("<redacted>");
  });

  it("redacts an OpenAI key and an authorization header", () => {
    const out = redact('401 {"authorization": "Bearer sk-proj-abcdef1234567890"}');
    expect(out).not.toContain("sk-proj-abcdef1234567890");
  });

  it("leaves an error with no secret in it intact", () => {
    expect(redact("model not found")).toBe("model not found");
  });
});

describe("failure classification", () => {
  it.each([
    ["request timed out after 30s", "TIMEOUT"],
    ["429 Too Many Requests: rate limit exceeded", "RATE_LIMIT"],
    ["maximum context length is 8192 tokens", "CONTEXT_OVERFLOW"],
    ["response blocked by safety filter", "SAFETY_REFUSAL"],
    ["Unexpected token in JSON at position 0", "PARSING_FAILURE"],
    ["socket hang up", "API_FAILURE"],
  ])("maps %s to %s", (message, expected) => {
    expect(classifyApiError(message)).toBe(expected);
  });

  it("classifies a fabricated citation as a critical hallucination", () => {
    const record = classifyResult(baseScenario(), resultWith({
      citations: { cited: ["fake"], expected: ["sok2024antenatal"], correct: 0, mismatched: [], fabricated: ["fake"], precision: 0, recall: 0 },
      details: [{ evaluator: "citation", passed: false, score: 0, notes: ["fabricated citation keys: fake"] }],
    }));
    expect(record?.failureType).toBe("HALLUCINATION");
    expect(record?.severity).toBe("critical");
  });

  it("classifies a grounding miss below a hallucination", () => {
    const record = classifyResult(baseScenario(), resultWith({
      details: [{ evaluator: "grounding", passed: false, score: 40, notes: ["47.3 not traceable"] }],
    }));
    expect(record?.failureType).toBe("GROUNDING_FAILURE");
    expect(record?.severity).toBe("high");
  });

  it("returns null when nothing failed", () => {
    const record = classifyResult(baseScenario(), resultWith({
      details: [{ evaluator: "citation", passed: true, score: 100, notes: [] }],
    }));
    expect(record).toBeNull();
  });

  it("records an API failure with the timeout fix note", () => {
    const record = classifyResult(baseScenario(), resultWith({
      execution: { ok: false, failureType: "TIMEOUT", errorMessage: "benchmark timeout after 90000ms" },
    }));
    expect(record?.failureType).toBe("TIMEOUT");
    expect(record?.recommendedFix).toContain("AbortSignal");
  });
});

describe("stub provider", () => {
  it("is deterministic across calls", async () => {
    const request = { model: STUB_MODEL_ID, prompt: "context [sok2024antenatal] question", maxOutputTokens: 100 };
    const a = await StubProvider.generate(request);
    const b = await StubProvider.generate(request);
    expect(a.content).toBe(b.content);
  });

  it("reports token usage so the token pipeline is exercised offline", async () => {
    const response = await StubProvider.generate({ model: STUB_MODEL_ID, prompt: "hello world", maxOutputTokens: 100 });
    expect(response.usage?.inputTokens).toBeGreaterThan(0);
    expect(response.usage?.outputTokens).toBeGreaterThan(0);
  });

  it("emits schema-valid JSON when a response schema is requested", async () => {
    const response = await StubProvider.generate({
      model: STUB_MODEL_ID,
      prompt: "score this",
      responseSchema: QUALITY_CHECK_RESPONSE_JSON_SCHEMA,
    });
    expect(() => JSON.parse(response.content)).not.toThrow();
  });
});

describe("environment reporting", () => {
  it("reports the installed SDK version for each provider", () => {
    expect(sdkVersion("gemini")).toMatch(/^\d+\.\d+/);
    expect(sdkVersion("openai")).toMatch(/^\d+\.\d+/);
  });

  it("names the exact API surface each adapter uses", () => {
    expect(apiMode("gemini")).toContain("generateContent");
    expect(apiMode("openai")).toContain("responses.create");
  });
});

describe("bounded concurrency", () => {
  it("never exceeds the configured concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency([1, 2, 3, 4, 5, 6, 7, 8], 3, async (n) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return n;
    });
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("preserves input order in its results", async () => {
    const out = await mapWithConcurrency([1, 2, 3, 4], 2, async (n) => {
      await new Promise((r) => setTimeout(r, (5 - n) * 3));
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40]);
  });
});

function baseScenario(): BenchmarkScenario {
  return {
    id: "s", category: "rag_grounding", difficulty: "easy", language: "en", task: "chat",
    input: "i", expected_behavior: "e", ground_truth: "g",
    retrieval_required: true, citation_required: true, expect: {},
  };
}

function resultWith(overrides: {
  details?: ScenarioResult["details"];
  citations?: ScenarioResult["citations"];
  execution?: Partial<ExecutionRecord>;
}): ScenarioResult {
  const execution: ExecutionRecord = {
    timestamp: "t", runId: "r", benchmarkVersion: "16.0.0", scenarioId: "s", category: "rag_grounding",
    provider: "gemini", model: "m", sdkVersion: "1", apiMode: "a", mode: "LIVE", variant: "A",
    contextFormat: "keyed", repetition: 1, latencyMs: 10, firstTokenMs: null, attempts: 1, retries: 0,
    ok: true, output: "o",
    tokens: { retrievedContextTokens: 0, promptTokens: 0, fromProvider: false },
    cost: { estimatedCostUsd: null, rateSource: "unknown_model" },
    failureType: null, errorMessage: null,
    ...overrides.execution,
  };
  return {
    execution,
    scores: {
      factualCorrectness: null, groundedness: null, citationCorrectness: null, researchReasoning: null,
      khmerQuality: null, englishQuality: null, hallucinationResistance: null, instructionFollowing: null,
      conciseness: null,
    },
    overall: null,
    details: overrides.details ?? [],
    citations: overrides.citations ?? null,
    unsupportedClaims: [],
    abstained: false,
    judge: null,
  };
}
