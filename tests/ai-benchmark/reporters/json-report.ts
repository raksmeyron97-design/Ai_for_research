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
  /**
   * What this artifact IS (Phase 21 §10).
   *
   * `dry` means every result came from the deterministic stub and no provider
   * was contacted; `live` means the harness was pointed at real providers.
   * It is recorded rather than inferred because the two are indistinguishable
   * downstream once the numbers are in a table, and a mocked score read as a
   * measured one is the worst failure mode this file has.
   *
   * Note what `live` does NOT assert: that any call succeeded. A live run
   * whose calls all come back UNAVAILABLE is still mode `live` — read
   * `execution_modes` for what actually happened.
   */
  mode: "live" | "dry";
  /**
   * How many calls actually went to a provider over the network.
   *
   * Recorded so "0 live calls" is a machine-checkable claim (Phase 21 §11,
   * §54) rather than something a reader takes on trust from the flag that was
   * set. For a dry run this must be 0, and
   * `scripts/verify-benchmark-isolation.sh` fails the gate if it is not.
   *
   * Deliberately NOT the request budget's counter. The budget authorises
   * *executions*, and a stubbed execution consumes budget exactly like a real
   * one — a full dry run spends 765 of them without opening a socket. Reading
   * that number as "provider calls" would have this field report 765 network
   * calls for a run that made none, which is precisely the live-versus-mocked
   * confusion §10 exists to end.
   *
   * So it is summed over executions that were not MOCKED, using each
   * execution's own `providerCalls` — which already counts the
   * orchestrator-internal extras (a retry, a cross-provider fallback, the
   * dual-model reviewer pass), and those are real calls that cost real money.
   */
  provider_calls: number;
  /**
   * Whether every planned call actually ran. A run truncated by a budget
   * ceiling or a cancellation reports fewer scenarios than the suite
   * defines, and its aggregate scores cover only what ran — that must be
   * visible, not inferred from a count.
   */
  completeness: { status: "complete" | "partial"; plannedCalls: number; skippedCalls: number; reason: string | null };
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
  return `${summary.group}:${summary.provider}:${summary.model}:variant${summary.variant}`;
}

export function buildReport(params: {
  runId: string;
  suite: string;
  mode: BenchmarkReport["mode"];
  plannedCalls: number;
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

  const skipped = params.results.filter((r) => r.execution.errorMessage?.startsWith("skipped:"));
  const skipReason = skipped[0]?.execution.errorMessage?.replace(/^skipped:\s*/, "") ?? null;

  return {
    phase: 16,
    status: params.status,
    benchmark_version: BENCHMARK_VERSION,
    run_id: params.runId,
    timestamp: new Date().toISOString(),
    commit: params.commit,
    suite: params.suite,
    mode: params.mode,
    provider_calls: params.results
      .filter((r) => r.execution.mode !== "MOCKED")
      .reduce((total, r) => total + (r.execution.providerCalls ?? 0), 0),
    completeness: {
      status: skipped.length > 0 ? "partial" : "complete",
      plannedCalls: params.plannedCalls,
      skippedCalls: skipped.length,
      reason: skipped.length > 0 ? skipReason : null,
    },
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
 * Preserve the live report a new live run is about to replace (Phase 22 §22D,
 * Phase 21 §61).
 *
 * Phase 21 stopped a dry run from overwriting the live record. It did not
 * stop a *live* run from overwriting the previous one, and that is the same
 * loss: `writeReport` writes `latest.json` in place, and the per-run copy it
 * keeps beside it goes to `raw/`, which `.gitignore` excludes. So the only
 * committed trace of any live run was `latest.json`, and the next live run
 * destroyed it.
 *
 * The file at risk is not hypothetical. `reports/ai-benchmark/latest.json`
 * is the record of the Phase 16B attempt — a successful credential probe and
 * twelve scenarios that all came back UNAVAILABLE. `reports/ai-benchmark/README.md`
 * describes it, `tests/production-readiness.test.ts` asserts against it, and
 * it cannot be regenerated: it is evidence of a provider state that no longer
 * obtains.
 *
 * Archiving is committed output, keyed by the run id inside the file it is
 * preserving rather than by the time it was archived, so re-running the
 * archive step is idempotent and the name says which run it holds.
 *
 * Dry runs are excluded deliberately. `dry/` is gitignored and every byte of
 * it is regenerable by re-running the gate, so archiving it would accumulate
 * stub reports to no purpose.
 */
export function archiveExistingLiveReport(outDir: string): string | null {
  const current = path.join(outDir, "latest.json");
  if (!fs.existsSync(current)) return null;

  let runId: string;
  try {
    const parsed = JSON.parse(fs.readFileSync(current, "utf8")) as { run_id?: string };
    runId = parsed.run_id ?? "unidentified";
  } catch {
    // A report that will not parse is still evidence, and losing it because
    // it is malformed would be the worst version of this bug.
    runId = "unparseable";
  }

  const archiveDir = path.join(outDir, "archive");
  fs.mkdirSync(archiveDir, { recursive: true });

  const target = path.join(archiveDir, `${runId}.json`);
  if (!fs.existsSync(target)) fs.copyFileSync(current, target);

  const currentMd = path.join(outDir, "latest.md");
  const targetMd = path.join(archiveDir, `${runId}.md`);
  if (fs.existsSync(currentMd) && !fs.existsSync(targetMd)) fs.copyFileSync(currentMd, targetMd);

  return target;
}

/**
 * Writes `latest.json` plus a timestamped raw dump. Raw records include the
 * model's full output text — that is scenario input from this repository's
 * own fixtures, never user content — and never a credential: provider error
 * strings pass through `redact()` before they get here.
 *
 * A live run archives the report it is replacing first; see
 * `archiveExistingLiveReport`.
 */
export function writeReport(outDir: string, runId: string, report: BenchmarkReport, results: ScenarioResult[]): void {
  if (report.mode === "live") archiveExistingLiveReport(outDir);
  fs.mkdirSync(path.join(outDir, "raw"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "latest.json"), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(
    path.join(outDir, "raw", `${runId}.json`),
    `${JSON.stringify({ report, results }, null, 2)}\n`,
  );
}
