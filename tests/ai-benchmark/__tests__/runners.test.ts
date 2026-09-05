import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeCost, loadConfig } from "../config";
import { AB_SCENARIO_IDS, ALL_SCENARIOS } from "../scenarios";
import { classifyApiError, classifyResult } from "../failure-taxonomy";
import { BenchmarkBudgetExceededError, RunBudget, mapWithConcurrency, redact } from "../runners/execute";
import { StubProvider, STUB_MODEL_ID } from "../runners/stub-provider";
import { apiMode, sdkVersion } from "../runners/preflight";
import { QUALITY_CHECK_RESPONSE_JSON_SCHEMA } from "@/lib/ai/schemas";
import type { BenchmarkConfig } from "../config";
import type { BenchmarkScenario, ExecutionRecord, ScenarioResult } from "../types";

function config(overrides: Partial<BenchmarkConfig> = {}): BenchmarkConfig {
  return { ...loadConfig(), ...overrides };
}

describe("budget ceilings are sized for the run they gate", () => {
  const envKeys = ["AI_BENCH_SUITE", "AI_BENCH_MAX_REQUESTS", "AI_BENCH_REPETITIONS"];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of envKeys) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of envKeys) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  /**
   * A ceiling below the planned call count truncates the run. That is now
   * visible (the report says PARTIAL) rather than silent, but a truncated
   * benchmark is still a wasted paid run, so the default must clear it.
   *
   * Since Phase 16B one scenario can cause several provider calls: a retry, a
   * cross-provider fallback, and the reviewer pass on advanced tasks. The
   * headroom below is deliberate, not slack.
   */
  it("the full-suite default clears the planned call count with headroom", () => {
    process.env.AI_BENCH_SUITE = "full";
    const cfg = loadConfig();

    const abExtra = AB_SCENARIO_IDS.length;
    const groups = 3; // gemini, openai, routed
    const plannedRuns = (ALL_SCENARIOS.length + abExtra) * cfg.repetitions * groups;

    expect(cfg.maxRequests).toBeGreaterThan(plannedRuns);
  });

  it("the smoke default clears its own planned calls", () => {
    const cfg = loadConfig();
    expect(cfg.suite).toBe("smoke");
    // 3 smoke scenarios (one of which has an A/B variant) x 3 groups, plus
    // room for the reviewer pass on the advanced-tier one.
    expect(cfg.maxRequests).toBeGreaterThanOrEqual(4 * 3);
  });

  it("the per-scenario backstop exceeds production's own retry-and-fallback budget", () => {
    // Orchestrator: 45s timeout, one retry, then a fallback attempt at the
    // same budget. A backstop below that would record normal recovery as a
    // harness timeout.
    expect(loadConfig().timeoutMs).toBeGreaterThanOrEqual(180_000);
  });
});

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

/**
 * Phase 22 §22E. The three tests above assert what `RunBudget` decides when
 * its counters hold certain values, and they passed throughout Phase 21 while
 * the cost ceiling was in fact unenforceable: nothing in the run path ever
 * incremented `costUsed`, so the only writer was a test assigning to it.
 * `AI_BENCH_MAX_COST_USD` was documented in `docs/ROADMAP.md` as the way to
 * cap a live compare at 15 USD, and it could not have stopped a run at any
 * price.
 *
 * These test the wiring instead: that spend is charged from a measured cost,
 * and that a ceiling actually refuses a call. They fail against the Phase 21
 * implementation.
 */
describe("run budget enforcement", () => {
  it("charges measured spend, so the cost ceiling can be reached by running", () => {
    const budget = new RunBudget(config({ maxRequests: 1000, maxCostUsd: 0.5 }));

    budget.recordSpend(0.2);
    budget.recordSpend(0.2);
    expect(budget.exhausted).toBe(false);

    budget.recordSpend(0.2);
    expect(budget.costUsed).toBeCloseTo(0.6, 6);
    expect(budget.exhausted).toBe(true);
    expect(budget.reason()).toContain("cost ceiling");
  });

  it("counts an unpriced execution as unpriced rather than charging a guess", () => {
    const budget = new RunBudget(config({ maxRequests: 1000, maxCostUsd: 0.5 }));

    budget.recordSpend(null);
    budget.recordSpend(undefined);

    // Nothing invented: an unpriced model contributes 0 to the ceiling, and
    // the run records how much of itself the ceiling could not see.
    expect(budget.costUsed).toBe(0);
    expect(budget.unpricedCalls).toBe(2);
    expect(budget.exhausted).toBe(false);
  });

  it("gate() counts a call, and refuses once the request ceiling is reached", () => {
    const budget = new RunBudget(config({ maxRequests: 2, maxCostUsd: null }));

    budget.gate();
    budget.gate();
    expect(budget.requestsUsed).toBe(2);

    // The third is refused *before* the network, which is the only thing that
    // makes the ceiling a hard stop for calls the orchestrator issues itself.
    expect(() => budget.gate()).toThrow(BenchmarkBudgetExceededError);
    expect(budget.requestsUsed).toBe(2);
    expect(budget.refusedCalls).toBe(1);
  });

  it("gate() refuses once measured spend reaches the cost ceiling", () => {
    const budget = new RunBudget(config({ maxRequests: 1000, maxCostUsd: 0.5 }));

    budget.gate();
    budget.recordSpend(0.75);

    expect(() => budget.gate()).toThrow(/cost ceiling/);
    expect(budget.refusedCalls).toBe(1);
  });

  it("a refused call is never counted as a request, however many are refused", () => {
    // The shape of a real overrun: the orchestrator answers a refusal with a
    // retry and a cross-provider fallback, each of which is refused in turn.
    // None of them reached a provider, so none may be billed to the run.
    const budget = new RunBudget(config({ maxRequests: 1, maxCostUsd: null }));
    budget.gate();

    for (let i = 0; i < 5; i += 1) {
      expect(() => budget.gate()).toThrow(BenchmarkBudgetExceededError);
    }

    expect(budget.requestsUsed).toBe(1);
    expect(budget.refusedCalls).toBe(5);
  });

  it("gate() refuses after cancellation", () => {
    const budget = new RunBudget(config({ maxRequests: 1000, maxCostUsd: null }));
    budget.cancel();
    expect(() => budget.gate()).toThrow(/run cancelled/);
  });
});

describe("cost accounting", () => {
  it("refuses to report a cost for a model nothing prices", () => {
    const cost = computeCost("gemini-x", 1000, 500, null);
    expect(cost.estimatedCostUsd).toBeNull();
    expect(cost.rateSource).toBe("unknown_model");
  });

  // Phase 16A: the app now carries verified rates, so the harness prices a
  // known model without needing an operator rate file.
  it("prices a known model from the application's verified rates", () => {
    const cost = computeCost("gemini-3.6-flash", 1_000_000, 1_000_000, null);
    expect(cost.rateSource).toBe("verified_app_pricing");
    expect(cost.estimatedCostUsd).toBeCloseTo(0.75 + 3.75, 10);
  });

  it("lets an operator rate file override the built-in rate", () => {
    const cost = computeCost("gemini-3.6-flash", 1_000_000, 0, {
      "gemini-3.6-flash": { inputPerMillion: 99, outputPerMillion: 0 },
    });
    expect(cost.rateSource).toBe("verified_rate_file");
    expect(cost.estimatedCostUsd).toBeCloseTo(99, 10);
  });

  it("computes cost from a verified rate file", () => {
    const rates = { "model-x": { inputPerMillion: 1, outputPerMillion: 4 } };
    const cost = computeCost("model-x", 1_000_000, 1_000_000, rates);
    expect(cost.estimatedCostUsd).toBeCloseTo(5, 10);
    expect(cost.rateSource).toBe("verified_rate_file");
  });

  it("marks a model absent from both the rate file and the app rates rather than guessing", () => {
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
    contextFormat: "keyed",
    group: "routed",
    tier: "standard",
    blockedByDatasetGuard: false,
    productionWarnings: [],
    providerCalls: 1,
    costConfidence: "verified", repetition: 1, latencyMs: 10, firstTokenMs: null, attempts: 1, retries: 0,
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
