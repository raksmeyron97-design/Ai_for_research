import fs from "node:fs";
import path from "node:path";
import type { ModelSummary } from "../aggregate";
import { BENCHMARK_VERSION, type FailureRecord, type ProviderStatus, type ScenarioResult } from "../types";

export interface BenchmarkReport {
  phase: 16;
  status: "READY" | "READY WITH CONDITIONS" | "NOT READY";
  benchmark_version: string;
  run_id: string;
  timestamp: string;
  commit: string | null;
  suite: string;
  execution_modes: Record<string, number>;
  providers: Record<string, ProviderStatus>;
  overall_scores: Record<string, number | null>;
  category_scores: Record<string, Record<string, number | null>>;
  latency: Record<string, unknown>;
  tokens: Record<string, unknown>;
  cost: Record<string, unknown>;
  rag: Record<string, unknown>;
  failures: FailureRecord[];
  recommendations: string[];
  caveats: string[];
}

function keyFor(summary: ModelSummary): string {
  return `${summary.provider}:${summary.model}:variant${summary.variant}`;
}

export function buildReport(params: {
  runId: string;
  suite: string;
  commit: string | null;
  status: BenchmarkReport["status"];
  statuses: ProviderStatus[];
  summaries: ModelSummary[];
  results: ScenarioResult[];
  failures: FailureRecord[];
  recommendations: string[];
  caveats: string[];
}): BenchmarkReport {
  const modes: Record<string, number> = {};
  for (const r of params.results) modes[r.execution.mode] = (modes[r.execution.mode] ?? 0) + 1;

  return {
    phase: 16,
    status: params.status,
    benchmark_version: BENCHMARK_VERSION,
    run_id: params.runId,
    timestamp: new Date().toISOString(),
    commit: params.commit,
    suite: params.suite,
    execution_modes: modes,
    providers: Object.fromEntries(params.statuses.map((s) => [s.provider, s])),
    overall_scores: Object.fromEntries(params.summaries.map((s) => [keyFor(s), s.overall])),
    category_scores: Object.fromEntries(params.summaries.map((s) => [keyFor(s), s.categories as Record<string, number | null>])),
    latency: Object.fromEntries(params.summaries.map((s) => [keyFor(s), s.latency])),
    tokens: Object.fromEntries(params.summaries.map((s) => [keyFor(s), s.tokens])),
    cost: Object.fromEntries(params.summaries.map((s) => [keyFor(s), s.cost])),
    rag: Object.fromEntries(
      params.summaries.map((s) => [
        keyFor(s),
        {
          citation_precision: s.citationPrecision,
          citation_recall: s.citationRecall,
          fabricated_citation_rate: s.fabricatedCitationRate,
          unsupported_claim_rate: s.unsupportedClaimRate,
          hallucination_rate: s.hallucinationRate,
          abstention_accuracy: s.abstentionAccuracy,
          by_answerability_class: s.ragByClass,
        },
      ]),
    ),
    failures: params.failures,
    recommendations: params.recommendations,
    caveats: params.caveats,
  };
}

/**
 * Writes `latest.json` plus a timestamped raw dump. Raw records include the
 * model's full output text — that is scenario input from this repository's
 * own fixtures, never user content — and never a credential: provider error
 * strings pass through `redact()` before they get here.
 */
export function writeReport(outDir: string, runId: string, report: BenchmarkReport, results: ScenarioResult[]): void {
  fs.mkdirSync(path.join(outDir, "raw"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(
    path.join(outDir, "raw", `${runId}.json`),
    `${JSON.stringify({ report, results }, null, 2)}\n`,
  );
}
