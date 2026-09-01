import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GeminiProvider } from "@/lib/ai/providers/gemini";
import { OpenAIProvider } from "@/lib/ai/providers/openai";
import { resetModelConfigCache } from "@/lib/ai/model-config";
import { createBenchmarkSupabase } from "../runners/benchmark-supabase";
import {
  installProviderInstrumentation,
  withCallCapture,
  withCallCaptureSettled,
} from "../runners/instrumented-providers";
import { applyGroupRouting, executeScenarioViaProduction } from "../runners/execute-production";
import { RunBudget } from "../runners/execute";
import { loadConfig } from "../config";
import { scenarioById } from "../scenarios";
import type { AIResponse, ProviderGenerateRequest } from "@/lib/ai/types";

/**
 * Phase 16B §7: the harness must measure the production path — classifier,
 * router, dataset guard, retry/fallback, usage accounting and citation
 * verification — not just the provider adapters.
 */
function stubResponse(text: string): (r: ProviderGenerateRequest) => Promise<AIResponse> {
  return async (request) => ({
    content: text,
    provider: "gemini",
    model: request.model,
    usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
  });
}

function config(overrides: Record<string, unknown> = {}) {
  return { ...loadConfig(), dryRun: true, ...overrides } as ReturnType<typeof loadConfig>;
}

afterEach(() => {
  delete process.env.AI_ENABLE_GEMINI;
  delete process.env.AI_ENABLE_OPENAI;
  resetModelConfigCache();
});

describe("benchmark Supabase fixture", () => {
  it("resolves citation keys that exist in the corpus", async () => {
    const { client } = createBenchmarkSupabase(new Set(["sok2024antenatal"]));
    const q = (client as never as { from: (t: string) => never }).from("research_citations") as never as {
      select: () => { eq: () => { in: (c: string, k: string[]) => Promise<{ data: { citation_key: string }[] }> } };
    };
    const { data } = await q.select().eq().in("citation_key", ["sok2024antenatal", "invented2020"]);
    expect(data.map((d) => d.citation_key)).toEqual(["sok2024antenatal"]);
  });

  it("captures ai_usage rows the orchestrator writes", async () => {
    const { client, usageRows } = createBenchmarkSupabase();
    await (client as never as { from: (t: string) => { insert: (r: unknown) => Promise<unknown> } })
      .from("ai_usage")
      .insert({ provider: "gemini", model: "m" });
    expect(usageRows).toHaveLength(1);
  });

  it("fails loudly on a table the harness does not model", () => {
    const { client } = createBenchmarkSupabase();
    // Returning empty data would look like a legitimate "nothing found" and
    // silently change what the orchestrator does.
    expect(() => (client as never as { from: (t: string) => unknown }).from("research_projects")).toThrow(
      /unexpected table/,
    );
  });
});

describe("provider instrumentation", () => {
  let restore: (() => void) | null = null;
  afterEach(() => {
    restore?.();
    restore = null;
  });

  it("counts every call, including ones the harness did not initiate", async () => {
    let counted = 0;
    const inst = installProviderInstrumentation({
      onCall: () => {
        counted += 1;
      },
      stub: stubResponse("ok"),
    });
    restore = inst.restore;

    await withCallCapture(async () => {
      await GeminiProvider.generate({ model: "m", prompt: "p" });
      await OpenAIProvider.generate({ model: "m", prompt: "p" });
    });

    expect(counted).toBe(2);
  });

  it("attributes calls to the right scenario when scenarios run concurrently", async () => {
    const inst = installProviderInstrumentation({ stub: stubResponse("ok") });
    restore = inst.restore;

    // The previous per-scenario patching approach double-counted here and
    // restored the wrong function; async-context attribution does not.
    const [a, b] = await Promise.all([
      withCallCapture(async () => {
        await GeminiProvider.generate({ model: "a1", prompt: "p" });
        await new Promise((r) => setTimeout(r, 5));
        await GeminiProvider.generate({ model: "a2", prompt: "p" });
      }),
      withCallCapture(async () => {
        await OpenAIProvider.generate({ model: "b1", prompt: "p" });
      }),
    ]);

    expect(a.calls.map((c) => c.model)).toEqual(["a1", "a2"]);
    expect(b.calls.map((c) => c.model)).toEqual(["b1"]);
  });

  it("records a failed call and still returns the calls made before the throw", async () => {
    const inst = installProviderInstrumentation({
      stub: async () => {
        throw new Error("boom");
      },
    });
    restore = inst.restore;

    const captured = await withCallCaptureSettled(async () => {
      await GeminiProvider.generate({ model: "m", prompt: "p" });
    });

    expect(captured.error).toBeInstanceOf(Error);
    expect(captured.calls).toHaveLength(1);
    expect(captured.calls[0].ok).toBe(false);
  });

  it("restores the original adapter methods", async () => {
    const before = GeminiProvider.generate;
    const inst = installProviderInstrumentation({ stub: stubResponse("ok") });
    expect(GeminiProvider.generate).not.toBe(before);
    inst.restore();
    expect(GeminiProvider.generate).toBe(before);
  });
});

describe("group routing", () => {
  it("pins a group to one provider through the real feature flags", () => {
    const restoreGemini = applyGroupRouting("gemini");
    expect(process.env.AI_ENABLE_OPENAI).toBe("false");
    restoreGemini();

    const restoreOpenai = applyGroupRouting("openai");
    expect(process.env.AI_ENABLE_GEMINI).toBe("false");
    restoreOpenai();
  });

  it("leaves both providers enabled for the routed group", () => {
    const restore = applyGroupRouting("routed");
    expect(process.env.AI_ENABLE_GEMINI).toBeUndefined();
    expect(process.env.AI_ENABLE_OPENAI).toBeUndefined();
    restore();
  });

  it("restores the previous environment", () => {
    process.env.AI_ENABLE_OPENAI = "true";
    const restore = applyGroupRouting("gemini");
    restore();
    expect(process.env.AI_ENABLE_OPENAI).toBe("true");
    delete process.env.AI_ENABLE_OPENAI;
  });
});

describe("executing a scenario through the production path", () => {
  let restore: (() => void) | null = null;
  beforeEach(() => {
    resetModelConfigCache();
  });
  afterEach(() => {
    restore?.();
    restore = null;
  });

  async function run(scenarioId: string, stub = stubResponse("A grounded answer [sok2024antenatal].")) {
    const inst = installProviderInstrumentation({ stub });
    restore = inst.restore;
    return executeScenarioViaProduction({
      scenario: scenarioById(scenarioId)!,
      group: "routed",
      variant: "A",
      repetition: 1,
      runId: "run_test",
      config: config(),
      budget: new RunBudget(config()),
    });
  }

  it("records the tier the production classifier assigned", async () => {
    const record = await run("rag-c1-prevalence-single");
    expect(record.tier).toBe("standard");
    expect(record.ok).toBe(true);
  });

  it("uses the model the production router chose, not one the harness supplied", async () => {
    const record = await run("rag-c1-prevalence-single");
    expect(record.model).toBe("gemini-3.6-flash");
    expect(record.apiMode).toContain("AIOrchestrator");
  });

  it("captures production-computed tokens and cost confidence", async () => {
    const record = await run("rag-c1-prevalence-single");
    expect(record.tokens.inputTokens).toBe(100);
    expect(record.tokens.fromProvider).toBe(true);
    expect(record.costConfidence).toBe("verified");
  });

  it("blocks a results request with no dataset before any model call (§15 Test A)", async () => {
    const record = await run("integrity-a-no-dataset-results");
    expect(record.blockedByDatasetGuard).toBe(true);
    expect(record.providerCalls).toBe(0);
    expect(record.output).toContain("Real research data is required");
  });

  it("raises the production injection warning for a tampered document (§15 Test D)", async () => {
    const record = await run("integrity-d-prompt-injection");
    expect(record.productionWarnings.some((w) => w.category === "security")).toBe(true);
  });

  it("attaches citation warnings for a key that resolves to no source", async () => {
    const record = await run("rag-c1-prevalence-single", stubResponse("Answer [invented2020key]."));
    expect(record.productionWarnings.some((w) => w.category === "citation")).toBe(true);
  });

  it("does not warn on a numbered list, per the F11 grammar", async () => {
    const record = await run("rag-c1-prevalence-single", stubResponse("[1] First point\n[2] Second point"));
    expect(record.productionWarnings.some((w) => w.category === "citation")).toBe(false);
  });

  it("skips without calling a provider when the budget is exhausted", async () => {
    const cfg = config({ maxRequests: 0 });
    const inst = installProviderInstrumentation({ stub: stubResponse("x") });
    restore = inst.restore;

    const record = await executeScenarioViaProduction({
      scenario: scenarioById("rag-c1-prevalence-single")!,
      group: "routed",
      variant: "A",
      repetition: 1,
      runId: "run_test",
      config: cfg,
      budget: new RunBudget(cfg),
    });

    expect(record.ok).toBe(false);
    expect(record.errorMessage).toContain("skipped");
    expect(record.providerCalls).toBe(0);
  });

  it("classifies a provider failure and redacts anything key-shaped from the error", async () => {
    const record = await run(
      "rag-c1-prevalence-single",
      async () => {
        throw new Error("429 rate limit; key=AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123");
      },
    );
    expect(record.ok).toBe(false);
    expect(record.failureType).toBe("RATE_LIMIT");
    expect(record.errorMessage).not.toContain("AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123");
  });
});
