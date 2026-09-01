import { weightedOverall } from "./evaluators";
import { classifyResult } from "./failure-taxonomy";
import { scenarioById } from "./scenarios";
import type {
  BenchmarkCategory,
  DimensionScores,
  FailureRecord,
  ProviderStatus,
  ScenarioResult,
  Variant,
} from "./types";

export interface LatencyStats {
  n: number;
  min: number;
  median: number;
  p95: number;
  max: number;
}

export interface TokenStats {
  medianInput: number | null;
  medianOutput: number | null;
  medianTotal: number | null;
  /** Provider-reported thinking/reasoning tokens; null when the model reports none. */
  medianReasoning: number | null;
  medianRetrievedContext: number;
  /** How many measurements came from provider usage metadata rather than a local estimate. */
  providerReported: number;
  estimated: number;
}

export interface ModelSummary {
  group: string;
  provider: string;
  model: string;
  variant: Variant;
  mode: string;
  scenarios: number;
  executions: number;
  successes: number;
  failures: number;
  failureRate: number;
  retryRate: number;
  overall: number | null;
  dimensions: DimensionScores;
  categories: Partial<Record<BenchmarkCategory, number | null>>;
  latency: LatencyStats;
  tokens: TokenStats;
  cost: {
    totalUsd: number | null;
    perRequestUsd: number | null;
    perSuccessUsd: number | null;
    rateSource: string;
  };
  hallucinationRate: number | null;
  /** Share of runs the orchestrator's dataset guard answered without any provider call. */
  datasetGuardBlockRate: number | null;
  /** Total provider calls, including orchestrator-internal fallback and reviewer passes. */
  providerCalls: number;
  /** Share of runs whose cost came from a verified rate. */
  verifiedCostRate: number | null;
  fabricatedCitationRate: number | null;
  citationPrecision: number | null;
  citationRecall: number | null;
  unsupportedClaimRate: number | null;
  abstentionAccuracy: number | null;
  qualityPerKiloToken: number | null;
  /** Per-answerability-class RAG breakdown (Step 6). A single RAG average hides the class that matters most. */
  ragByClass: Record<string, RagClassStats>;
}

export interface RagClassStats {
  n: number;
  overall: number | null;
  groundedness: number | null;
  citationPrecision: number | null;
  citationRecall: number | null;
  /** Class 3's headline number: how often the model correctly refused. */
  abstentionAccuracy: number | null;
  unsupportedClaimRate: number | null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function mean(values: (number | null)[]): number | null {
  const nums = values.filter((v): v is number => v !== null && Number.isFinite(v));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

/**
 * Conciseness can only be judged relative to other answers to the *same*
 * scenario: 200 output tokens is terse for a thesis outline and bloated for
 * a 60-word summary. Each response is scored against the shortest
 * successful answer any model gave to that scenario, so brevity is only
 * rewarded among answers that were actually produced.
 */
export function applyConcisenessScores(results: ScenarioResult[]): void {
  const bestByScenario = new Map<string, number>();
  for (const r of results) {
    if (!r.execution.ok) continue;
    const out = r.execution.tokens.outputTokens ?? Math.ceil(r.execution.output.length / 4);
    const current = bestByScenario.get(r.execution.scenarioId);
    if (current === undefined || out < current) bestByScenario.set(r.execution.scenarioId, out);
  }

  for (const r of results) {
    if (!r.execution.ok) continue;
    const out = r.execution.tokens.outputTokens ?? Math.ceil(r.execution.output.length / 4);
    const best = bestByScenario.get(r.execution.scenarioId) ?? out;
    // Ratio-based, capped: an answer 4x longer than the shortest scores 0.
    const ratio = best > 0 ? out / best : 1;
    r.scores.conciseness = Math.max(0, Math.min(100, 100 - (ratio - 1) * 33));
    r.overall = weightedOverall(r.scores);
  }
}

export function summarize(results: ScenarioResult[]): ModelSummary {
  const first = results[0].execution;
  const successes = results.filter((r) => r.execution.ok);
  const latencies = successes.map((r) => r.execution.latencyMs);

  const withUsage = successes.filter((r) => r.execution.tokens.fromProvider);
  const outputsFor = (key: "inputTokens" | "outputTokens" | "totalTokens" | "reasoningTokens") =>
    withUsage.map((r) => r.execution.tokens[key]).filter((n): n is number => n !== undefined);

  const costs = successes
    .map((r) => r.execution.cost.estimatedCostUsd)
    .filter((c): c is number => c !== null);
  const totalCost = costs.length ? costs.reduce((a, b) => a + b, 0) : null;

  const citationScenarios = successes.filter((r) => r.citations && r.citations.expected.length > 0);
  const fabricated = successes.filter((r) => (r.citations?.fabricated.length ?? 0) > 0);
  const hallucinationFailures = successes.filter((r) =>
    r.details.some((d) => !d.passed && ["abstention", "false_premise", "conflict_detection", "forbidden_content"].includes(d.evaluator)),
  );
  const hallucinationCandidates = successes.filter((r) =>
    r.details.some((d) => ["abstention", "false_premise", "conflict_detection", "forbidden_content"].includes(d.evaluator)),
  );
  const abstentionCases = successes.filter((r) => r.details.some((d) => d.evaluator === "abstention"));

  const dimensions: DimensionScores = {
    factualCorrectness: mean(successes.map((r) => r.scores.factualCorrectness)),
    groundedness: mean(successes.map((r) => r.scores.groundedness)),
    citationCorrectness: mean(successes.map((r) => r.scores.citationCorrectness)),
    researchReasoning: mean(successes.map((r) => r.scores.researchReasoning)),
    khmerQuality: mean(successes.map((r) => r.scores.khmerQuality)),
    englishQuality: mean(successes.map((r) => r.scores.englishQuality)),
    hallucinationResistance: mean(successes.map((r) => r.scores.hallucinationResistance)),
    instructionFollowing: mean(successes.map((r) => r.scores.instructionFollowing)),
    conciseness: mean(successes.map((r) => r.scores.conciseness)),
  };

  const categories: Partial<Record<BenchmarkCategory, number | null>> = {};
  for (const r of successes) {
    const cat = r.execution.category;
    categories[cat] = categories[cat] ?? null;
  }
  for (const cat of Object.keys(categories) as BenchmarkCategory[]) {
    categories[cat] = mean(successes.filter((r) => r.execution.category === cat).map((r) => r.overall));
  }

  const overall = mean(successes.map((r) => r.overall));
  const medianTotal = median(outputsFor("totalTokens"));
  const ragByClass = summarizeRagClasses(successes);

  return {
    group: first.group,
    provider: first.provider,
    model: first.model,
    variant: first.variant,
    mode: first.mode,
    scenarios: new Set(results.map((r) => r.execution.scenarioId)).size,
    executions: results.length,
    successes: successes.length,
    failures: results.length - successes.length,
    failureRate: results.length ? (results.length - successes.length) / results.length : 0,
    retryRate: results.length ? results.filter((r) => r.execution.retries > 0).length / results.length : 0,
    overall,
    dimensions,
    categories,
    latency: {
      n: latencies.length,
      min: latencies.length ? Math.min(...latencies) : 0,
      median: median(latencies),
      p95: percentile(latencies, 95),
      max: latencies.length ? Math.max(...latencies) : 0,
    },
    tokens: {
      medianInput: outputsFor("inputTokens").length ? median(outputsFor("inputTokens")) : null,
      medianOutput: outputsFor("outputTokens").length ? median(outputsFor("outputTokens")) : null,
      medianTotal: outputsFor("totalTokens").length ? medianTotal : null,
      medianReasoning: outputsFor("reasoningTokens").length ? median(outputsFor("reasoningTokens")) : null,
      medianRetrievedContext: median(successes.map((r) => r.execution.tokens.retrievedContextTokens)),
      providerReported: withUsage.length,
      estimated: successes.length - withUsage.length,
    },
    cost: {
      totalUsd: totalCost,
      perRequestUsd: totalCost !== null && results.length ? totalCost / results.length : null,
      perSuccessUsd: totalCost !== null && successes.length ? totalCost / successes.length : null,
      rateSource: successes[0]?.execution.cost.rateSource ?? "unknown_model",
    },
    hallucinationRate: hallucinationCandidates.length
      ? hallucinationFailures.length / hallucinationCandidates.length
      : null,
    datasetGuardBlockRate: results.length
      ? results.filter((r) => r.execution.blockedByDatasetGuard).length / results.length
      : null,
    providerCalls: results.reduce((sum, r) => sum + r.execution.providerCalls, 0),
    verifiedCostRate: successes.length
      ? successes.filter((r) => r.execution.costConfidence === "verified").length / successes.length
      : null,
    fabricatedCitationRate: successes.length ? fabricated.length / successes.length : null,
    citationPrecision: mean(citationScenarios.map((r) => r.citations?.precision ?? null)),
    citationRecall: mean(citationScenarios.map((r) => r.citations?.recall ?? null)),
    unsupportedClaimRate: successes.length
      ? successes.filter((r) => r.unsupportedClaims.length > 0).length / successes.length
      : null,
    abstentionAccuracy: abstentionCases.length
      ? abstentionCases.filter((r) => r.details.find((d) => d.evaluator === "abstention")?.passed).length /
        abstentionCases.length
      : null,
    qualityPerKiloToken:
      overall !== null && medianTotal > 0 ? overall / (medianTotal / 1000) : null,
    ragByClass,
  };
}

/**
 * Splits RAG results by answerability class. Reported separately because
 * the classes measure opposite behaviours: Class 1 rewards answering,
 * Class 3 rewards refusing. Averaging them produces a number that goes up
 * when a model gets better at one and worse at the other.
 */
function summarizeRagClasses(successes: ScenarioResult[]): Record<string, RagClassStats> {
  const out: Record<string, RagClassStats> = {};

  for (const cls of [1, 2, 3, 4]) {
    const rows = successes.filter((r) => scenarioById(r.execution.scenarioId)?.ragClass === cls);
    if (rows.length === 0) continue;

    const abstentionRows = rows.filter((r) => r.details.some((d) => d.evaluator === "abstention"));
    // Only scenarios that actually expect a citation contribute to
    // precision/recall — a Class 3 abstention has no expected citation, and
    // counting it as precision 0 would penalise the correct behaviour.
    const citationRows = rows.filter((r) => (r.citations?.expected.length ?? 0) > 0);
    out[`class_${cls}`] = {
      n: rows.length,
      overall: mean(rows.map((r) => r.overall)),
      groundedness: mean(rows.map((r) => r.scores.groundedness)),
      citationPrecision: mean(citationRows.map((r) => r.citations?.precision ?? null)),
      citationRecall: mean(citationRows.map((r) => r.citations?.recall ?? null)),
      abstentionAccuracy: abstentionRows.length
        ? abstentionRows.filter((r) => r.details.find((d) => d.evaluator === "abstention")?.passed).length /
          abstentionRows.length
        : null,
      unsupportedClaimRate: rows.length
        ? rows.filter((r) => r.unsupportedClaims.length > 0).length / rows.length
        : null,
    };
  }

  return out;
}

/**
 * A failure seen in more than one repetition of the same scenario/model is
 * marked reproducible. One-off failures are still reported, flagged as
 * not-yet-reproduced, rather than dropped.
 */
export function collectFailures(results: ScenarioResult[]): FailureRecord[] {
  const failures: FailureRecord[] = [];
  const seen = new Map<string, number>();

  for (const result of results) {
    const scenario = scenarioById(result.execution.scenarioId);
    if (!scenario) continue;
    const record = classifyResult(scenario, result);
    if (!record) continue;
    const key = `${record.scenarioId}|${record.provider}|${record.model}|${record.failureType}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
    failures.push(record);
  }

  const deduped = new Map<string, FailureRecord>();
  for (const record of failures) {
    const key = `${record.scenarioId}|${record.provider}|${record.model}|${record.failureType}`;
    record.reproducible = (seen.get(key) ?? 0) > 1;
    if (!deduped.has(key)) deduped.set(key, record);
  }

  const severityRank = { critical: 0, high: 1, medium: 2, low: 3 };
  return [...deduped.values()].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
}

export function overallStatus(
  statuses: ProviderStatus[],
  summaries: ModelSummary[],
): "READY" | "READY WITH CONDITIONS" | "NOT READY" {
  const anyLive = statuses.some((s) => s.status === "LIVE");
  const liveSummaries = summaries.filter((s) => s.mode === "LIVE");

  // No live measurement means the question this phase exists to answer was
  // not answered. That is NOT READY, regardless of how the code looks.
  if (!anyLive || liveSummaries.length === 0) return "NOT READY";

  const best = liveSummaries.reduce((a, b) => ((a.overall ?? 0) >= (b.overall ?? 0) ? a : b));
  const fabricated = best.fabricatedCitationRate ?? 1;
  const hallucination = best.hallucinationRate ?? 1;

  if (fabricated > 0.02 || hallucination > 0.2 || (best.overall ?? 0) < 60) return "NOT READY";
  if (fabricated > 0 || hallucination > 0.1 || (best.overall ?? 0) < 80 || best.failureRate > 0.05) {
    return "READY WITH CONDITIONS";
  }
  return "READY";
}
