import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applyConcisenessScores, collectFailures, overallStatus, summarize } from "../aggregate";
import { buildReport, writeReport } from "../reporters/json-report";
import { renderMarkdown } from "../reporters/markdown-report";
import { scoreExecution } from "../evaluators";
import { scenarioById } from "../scenarios";
import type { ExecutionRecord, ProviderStatus, ScenarioResult } from "../types";

function execution(overrides: Partial<ExecutionRecord> = {}): ExecutionRecord {
  return {
    timestamp: "2026-01-01T00:00:00.000Z",
    runId: "run_test",
    benchmarkVersion: "16.0.0",
    scenarioId: "rag-c1-prevalence-single",
    category: "rag_grounding",
    provider: "gemini",
    model: "test-model",
    sdkVersion: "2.19.0",
    apiMode: "test",
    mode: "LIVE",
    variant: "A",
    contextFormat: "production",
    repetition: 1,
    latencyMs: 1000,
    firstTokenMs: null,
    attempts: 1,
    retries: 0,
    ok: true,
    output: "Prevalence was 21.4% among urban health centre attendees [sok2024antenatal].",
    tokens: { inputTokens: 500, outputTokens: 100, totalTokens: 600, retrievedContextTokens: 400, promptTokens: 480, fromProvider: true },
    cost: { estimatedCostUsd: null, rateSource: "unverified_placeholder" },
    failureType: null,
    errorMessage: null,
    ...overrides,
  };
}

function scored(overrides: Partial<ExecutionRecord> = {}): ScenarioResult {
  const record = execution(overrides);
  return scoreExecution(scenarioById(record.scenarioId)!, record);
}

const statuses: ProviderStatus[] = [
  {
    provider: "gemini",
    credentialPresent: true,
    reachable: true,
    status: "LIVE",
    discoveredModels: ["test-model"],
    sdkVersion: "2.19.0",
    apiMode: "test",
    reason: "ok",
  },
];

describe("scoring an execution", () => {
  it("scores a correct, grounded, correctly cited answer highly", () => {
    const result = scored();
    expect(result.overall).not.toBeNull();
    expect(result.overall!).toBeGreaterThan(70);
    expect(result.citations?.fabricated).toEqual([]);
  });

  it("caps hallucination resistance when a citation is fabricated", () => {
    const result = scored({ output: "Prevalence was 21.4% [invented2020source]." });
    expect(result.scores.hallucinationResistance).toBeLessThanOrEqual(20);
  });

  it("produces no scores for a failed execution and records the error", () => {
    const result = scored({ ok: false, output: "", errorMessage: "boom", failureType: "API_FAILURE" });
    expect(result.overall).toBeNull();
    expect(result.details[0].notes[0]).toBe("boom");
  });
});

describe("aggregation", () => {
  it("scores conciseness relative to the shortest answer to the same scenario", () => {
    const short = scored({ output: "21.4% at urban health centres [sok2024antenatal].", tokens: { inputTokens: 500, outputTokens: 20, totalTokens: 520, retrievedContextTokens: 400, promptTokens: 480, fromProvider: true } });
    const long = scored({ model: "verbose", tokens: { inputTokens: 500, outputTokens: 200, totalTokens: 700, retrievedContextTokens: 400, promptTokens: 480, fromProvider: true } });
    applyConcisenessScores([short, long]);
    expect(short.scores.conciseness).toBe(100);
    expect(long.scores.conciseness!).toBeLessThan(100);
  });

  it("summarises latency percentiles and token medians", () => {
    const results = [scored({ latencyMs: 100 }), scored({ latencyMs: 900 }), scored({ latencyMs: 500 })];
    const summary = summarize(results);
    expect(summary.latency.median).toBe(500);
    expect(summary.latency.min).toBe(100);
    expect(summary.latency.max).toBe(900);
    expect(summary.tokens.medianTotal).toBe(600);
    expect(summary.tokens.providerReported).toBe(3);
  });

  it("separates provider-reported usage from locally estimated usage", () => {
    const estimated = scored({ tokens: { retrievedContextTokens: 400, promptTokens: 480, fromProvider: false } });
    const summary = summarize([scored(), estimated]);
    expect(summary.tokens.providerReported).toBe(1);
    expect(summary.tokens.estimated).toBe(1);
  });

  it("marks a failure seen in more than one repetition as reproducible", () => {
    const bad = { output: "Prevalence was 47.3% [fabricated2020key]." };
    const failures = collectFailures([scored({ ...bad, repetition: 1 }), scored({ ...bad, repetition: 2 })]);
    expect(failures[0].reproducible).toBe(true);
    expect(failures[0].failureType).toBe("HALLUCINATION");
  });

  it("does not claim reproducibility from a single observation", () => {
    const failures = collectFailures([scored({ output: "Prevalence was 47.3% [fabricated2020key]." })]);
    expect(failures[0].reproducible).toBe(false);
  });
});

describe("production status", () => {
  it("is NOT READY when no provider was measured live", () => {
    const offline: ProviderStatus[] = [{ ...statuses[0], status: "UNAVAILABLE", credentialPresent: false, reachable: null }];
    expect(overallStatus(offline, [])).toBe("NOT READY");
  });

  it("is NOT READY when a live run fabricates citations above the threshold", () => {
    const summary = summarize([scored({ output: "21.4% [invented2020key]." })]);
    expect(overallStatus(statuses, [summary])).toBe("NOT READY");
  });

  it("never returns READY from a mocked run", () => {
    const summary = summarize([scored({ mode: "MOCKED" })]);
    expect(overallStatus(statuses, [summary])).toBe("NOT READY");
  });
});

describe("report generation", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
    tmpDirs.length = 0;
  });

  it("produces a machine-readable report with the Step 25 keys", () => {
    const summary = summarize([scored()]);
    const report = buildReport({
      runId: "run_test", suite: "smoke", commit: "abc1234", status: "NOT READY",
      statuses, summaries: [summary], results: [scored()], failures: [],
      recommendations: ["r"], caveats: ["c"],
    });

    for (const key of [
      "phase", "status", "benchmark_version", "providers", "overall_scores",
      "category_scores", "latency", "tokens", "cost", "failures", "recommendations",
    ]) {
      expect(report, `missing key ${key}`).toHaveProperty(key);
    }
    expect(report.phase).toBe(16);
    expect(report.execution_modes.LIVE).toBe(1);
  });

  it("writes latest.json and a timestamped raw dump", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "bench-report-"));
    tmpDirs.push(dir);
    const summary = summarize([scored()]);
    const report = buildReport({
      runId: "run_test", suite: "smoke", commit: null, status: "NOT READY",
      statuses, summaries: [summary], results: [scored()], failures: [], recommendations: [], caveats: [],
    });

    writeReport(dir, "run_test", report, [scored()]);
    expect(fs.existsSync(path.join(dir, "latest.json"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "raw", "run_test.json"))).toBe(true);
    expect(JSON.parse(fs.readFileSync(path.join(dir, "latest.json"), "utf8")).phase).toBe(16);
  });

  it("renders caveats above the results so no number is quoted without them", () => {
    const summary = summarize([scored()]);
    const report = buildReport({
      runId: "run_test", suite: "smoke", commit: null, status: "NOT READY",
      statuses, summaries: [summary], results: [scored()], failures: [],
      recommendations: [], caveats: ["**This run is MOCKED.**"],
    });

    const markdown = renderMarkdown(report, [summary]);
    expect(markdown.indexOf("MOCKED")).toBeLessThan(markdown.indexOf("## Overall"));
    expect(markdown).toContain("## Rubric dimensions");
    expect(markdown).toContain("## Category scores");
  });

  it("states plainly when there is nothing to report", () => {
    const report = buildReport({
      runId: "run_test", suite: "smoke", commit: null, status: "NOT READY",
      statuses, summaries: [], results: [], failures: [], recommendations: [], caveats: [],
    });
    expect(renderMarkdown(report, [])).toContain("Nothing about model quality can be concluded");
  });
});
