import { execSync } from "node:child_process";
import { applyConcisenessScores, collectFailures, overallStatus, summarize, type ModelSummary } from "./aggregate";
import { loadConfig, type BenchmarkConfig } from "./config";
import { scoreExecution } from "./evaluators";
import { judgeResponse, pickJudge } from "./evaluators/llm-judge";
import { buildScenarioContext } from "./fixtures/context";
import { buildReport, writeReport } from "./reporters/json-report";
import { renderMarkdown, writeMarkdown } from "./reporters/markdown-report";
import { AB_SCENARIO_IDS, selectScenarios } from "./scenarios";
import { mapWithConcurrency, newRunId, RunBudget } from "./runners/execute";
import { applyGroupRouting, executeScenarioViaProduction } from "./runners/execute-production";
import { configuredModels, preflight } from "./runners/preflight";
import { StubProvider } from "./runners/stub-provider";
import { installProviderInstrumentation } from "./runners/instrumented-providers";
import type {
  BenchmarkScenario,
  ExecutionRecord,
  ProviderStatus,
  ScenarioResult,
  TestGroup,
  Variant,
} from "./types";

function commitSha(): string | null {
  try {
    return execSync("git rev-parse --short HEAD", { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

interface Unit {
  scenario: BenchmarkScenario;
  group: TestGroup;
  variant: Variant;
  repetition: number;
}

/**
 * Expands one test group into scenario runs. Variant B is only run for the
 * designated A/B scenarios (Step 21) — running both arms on every scenario
 * would double the bill to answer a question five scenarios can answer.
 */
function buildUnits(scenarios: BenchmarkScenario[], group: TestGroup, config: BenchmarkConfig): Unit[] {
  const units: Unit[] = [];
  for (const scenario of scenarios) {
    const variants: Variant[] = AB_SCENARIO_IDS.includes(scenario.id) ? ["A", "B"] : ["A"];
    for (const variant of variants) {
      for (let repetition = 1; repetition <= config.repetitions; repetition += 1) {
        units.push({ scenario, group, variant, repetition });
      }
    }
  }
  return units;
}

/**
 * Which routing regimes to run. `routed` is always included when both
 * providers are enabled: it is the only group that can tell us whether the
 * shipped routing table sends each task to the right place, which the pinned
 * groups cannot by construction.
 */
function groupsFor(config: BenchmarkConfig): TestGroup[] {
  const groups: TestGroup[] = [];
  if (config.providers.includes("gemini")) groups.push("gemini");
  if (config.providers.includes("openai")) groups.push("openai");
  if (config.providers.length > 1) groups.push("routed");
  return groups;
}

function buildCaveats(config: BenchmarkConfig, statuses: ProviderStatus[], results: ScenarioResult[]): string[] {
  const caveats: string[] = [];

  const unavailable = statuses.filter((s) => s.status === "UNAVAILABLE");
  for (const s of unavailable) {
    caveats.push(`**${s.provider}: PROVIDER_UNAVAILABLE.** ${s.reason}`);
  }

  if (config.dryRun) {
    caveats.push(
      "**This run is MOCKED.** Every response came from the deterministic stub in `runners/stub-provider.ts`, not from a model. It validates the harness, and says nothing whatsoever about Gemini or OpenAI quality.",
    );
  }

  const unpricedModels = [
    ...new Set(
      results
        .filter((r) => r.execution.ok && r.execution.cost.rateSource === "unknown_model")
        .map((r) => r.execution.model),
    ),
  ];
  if (unpricedModels.length > 0) {
    caveats.push(
      `**No cost figure for ${unpricedModels.join(", ")}.** Neither \`src/lib/ai/pricing.ts\` nor any supplied rate file prices these models, so they contribute nothing to the cost totals rather than contributing a guess.`,
    );
  }

  const estimated = results.filter((r) => r.execution.ok && !r.execution.tokens.fromProvider).length;
  if (estimated > 0) {
    caveats.push(
      `**${estimated} execution(s) have locally estimated token counts**, not provider-reported usage. Treat their token and cost figures as approximate.`,
    );
  }

  if (config.repetitions < 3) {
    caveats.push(
      `**${config.repetitions} repetition(s) per scenario.** Latency percentiles from fewer than 3 runs describe this run, not the model.`,
    );
  }

  if (config.suite === "smoke") {
    caveats.push("**Smoke suite only.** A subset of scenarios ran; category coverage is incomplete.");
  }

  return caveats;
}

function buildRecommendations(summaries: ModelSummary[], statuses: ProviderStatus[]): string[] {
  const recs: string[] = [];
  const live = summaries.filter((s) => s.mode === "LIVE");

  if (live.length === 0) {
    const credentialed = statuses.filter((s) => s.status === "LIVE");
    if (credentialed.length === 0) {
      recs.push(
        "No live model measurement exists: no provider credential was available. Set GEMINI_API_KEY and/or OPENAI_API_KEY and re-run `npm run ai:benchmark:full` before making any model-selection decision.",
      );
    } else {
      // The credential works — preflight listed models — but every
      // generation call failed. Telling the operator to "set the API key"
      // here would send them to fix the one thing that is already correct.
      recs.push(
        `No live model measurement exists despite a working credential for ${credentialed
          .map((s) => s.provider)
          .join(" and ")}: every generation call failed. See the failure table for the provider error before re-running.`,
      );
    }
    return recs;
  }

  const byOverall = [...live].sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
  recs.push(`Highest overall score: ${byOverall[0].provider}/${byOverall[0].model} (${(byOverall[0].overall ?? 0).toFixed(1)}).`);

  const byGrounding = [...live].sort((a, b) => (b.dimensions.groundedness ?? 0) - (a.dimensions.groundedness ?? 0));
  recs.push(`Best grounding for RAG/citation work: ${byGrounding[0].provider}/${byGrounding[0].model}.`);

  const byEfficiency = [...live].filter((s) => s.qualityPerKiloToken !== null)
    .sort((a, b) => (b.qualityPerKiloToken ?? 0) - (a.qualityPerKiloToken ?? 0));
  if (byEfficiency.length) {
    recs.push(`Best quality per 1K tokens (high-volume/low-cost tier): ${byEfficiency[0].provider}/${byEfficiency[0].model}.`);
  }

  const abA = live.filter((s) => s.variant === "A");
  const abB = live.filter((s) => s.variant === "B");
  if (abA.length && abB.length) {
    const meanOf = (rows: ModelSummary[]) =>
      rows.reduce((sum, r) => sum + (r.dimensions.citationCorrectness ?? 0), 0) / rows.length;
    const delta = meanOf(abB) - meanOf(abA);
    recs.push(
      `Prompt/context A/B: variant B (citation-keyed context + citation contract) changed citation correctness by ${delta.toFixed(1)} points. ${
        delta > 5 ? "This supports changing the production context format." : "This does not yet justify a production prompt change."
      }`,
    );
  }

  for (const s of statuses.filter((st) => st.status === "UNAVAILABLE")) {
    recs.push(`${s.provider} was not measured (${s.reason}); no routing decision involving it is evidence-backed.`);
  }

  return recs;
}

export interface RunOutcome {
  status: "READY" | "READY WITH CONDITIONS" | "NOT READY";
  statuses: ProviderStatus[];
  summaries: ModelSummary[];
  results: ScenarioResult[];
  markdown: string;
}

export async function runBenchmark(overrides: Partial<BenchmarkConfig> = {}): Promise<RunOutcome> {
  const config = { ...loadConfig(), ...overrides };
  const runId = newRunId();
  const budget = new RunBudget(config);

  const onSigint = () => {
    budget.cancel();
    console.error("\n[benchmark] cancellation requested — finishing in-flight calls and writing the report.");
  };
  process.on("SIGINT", onSigint);

  try {
    const statuses = config.dryRun
      ? config.providers.map<ProviderStatus>((provider) => ({
          provider,
          credentialPresent: false,
          reachable: null,
          status: "MOCKED",
          discoveredModels: null,
          sdkVersion: "n/a (stub)",
          apiMode: "deterministic stub (no network call)",
          reason: "Dry run: the deterministic stub answered. No provider was contacted.",
        }))
      : await preflight(config.providers);

    // Model discovery is now advisory rather than a selector: the production
    // router chooses the model for each task, which is the point of §7. This
    // still flags a configured model the key does not enumerate.
    for (const provider of config.providers) {
      if (config.dryRun) continue;
      const status = statuses.find((s) => s.provider === provider);
      if (status?.status !== "LIVE") continue;
      const requested = config.models[provider] ?? configuredModels(provider);
      // A model missing from models.list is NOT proof the model is
      // unusable: providers serve aliases they do not enumerate. Measured
      // on 2026-09-01, `gpt-5.6` is absent from the 118 ids this key lists,
      // yet a Responses call to it is accepted (it reaches the billing
      // check), while a genuinely bogus id is rejected with 400 "does not
      // exist" before billing. So an unlisted model is flagged, never
      // dropped — silently excluding a working model would produce a
      // report that omits the app's own reasoning tier without saying so.
      const available = status.discoveredModels;

      const unlisted = available
        ? requested.filter((m: string) => !available.includes(m) && !available.includes(`models/${m}`))
        : [];
      if (unlisted.length) {
        status.reason +=
          ` Configured model(s) not enumerated by this key's model list, benchmarked anyway` +
          ` (an unlisted id may still be a served alias): ${unlisted.join(", ")}.`;
      }
    }

    const scenarios = selectScenarios({
      suite: config.suite,
      scenarioFilter: config.scenarioFilter,
      categoryFilter: config.categoryFilter,
      maxScenarios: config.maxScenarios,
    });

    const groups = groupsFor(config);
    const allUnits = groups.flatMap((group) => buildUnits(scenarios, group, config));

    console.log(
      `[benchmark] run ${runId}: ${scenarios.length} scenarios x ${groups.join("/")} = ` +
        `${allUnits.length} planned scenario runs (suite=${config.suite}, reps=${config.repetitions}, ` +
        `dryRun=${config.dryRun}, maxRequests=${config.maxRequests}). ` +
        `Each run drives the full production path, so it may make more than one provider call.`,
    );

    // Installed once for the whole run. It counts every provider call for the
    // budget — including the orchestrator's own retries, fallbacks and
    // reviewer passes — and, in a dry run, swaps only the network call so
    // that classification, routing, guards, usage accounting and citation
    // verification still execute for real.
    const instrumentation = installProviderInstrumentation({
      // `gate()` counts the call and refuses it once a ceiling is reached.
      // Phase 22 §22E: doing this here rather than between scenarios is what
      // makes the ceiling a hard stop — a retry, a fallback and a reviewer
      // pass are all issued below the harness and were previously invisible
      // to it.
      onCall: () => budget.gate(),
      stub: config.dryRun ? StubProvider.generate.bind(StubProvider) : undefined,
    });

    const executions: ExecutionRecord[] = [];
    const orderedUnits: Unit[] = [];

    try {
      // Groups run sequentially: each one sets process-global provider flags,
      // so overlapping them would race on the same environment.
      for (const group of groups) {
        const restoreRouting = applyGroupRouting(group);
        try {
          const units = allUnits.filter((u) => u.group === group);
          const groupExecutions = await mapWithConcurrency(units, config.concurrency, (unit) =>
            executeScenarioViaProduction({ ...unit, runId, config, budget }),
          );
          executions.push(...groupExecutions);
          orderedUnits.push(...units);
        } finally {
          restoreRouting();
        }
      }
    } finally {
      instrumentation.restore();
    }

    const units = orderedUnits;
    const results: ScenarioResult[] = executions.map((execution, i) => scoreExecution(units[i].scenario, execution));
    applyConcisenessScores(results);

    if (config.judge && !config.dryRun) {
      const liveProviders = statuses.filter((s) => s.status === "LIVE").map((s) => s.provider);
      await mapWithConcurrency(results, config.concurrency, async (result, i) => {
        const judge = pickJudge(result.execution.provider, liveProviders, (p) => configuredModels(p)[0]);
        if (!judge || budget.exhausted) return;
        // The judge pass does not go through the instrumented adapters, so it
        // charges itself. `gate()` rather than a bare increment, so a judge
        // call cannot be the one thing that walks past the ceiling.
        try {
          budget.gate();
        } catch {
          return;
        }
        result.judge = await judgeResponse({
          scenario: units[i].scenario,
          result,
          evidence: buildScenarioContext(units[i].scenario, "keyed").text,
          judgeProvider: judge.provider,
          judgeModel: judge.model,
          timeoutMs: config.timeoutMs,
        });
      });
    }

    // Summarised per (test group x model x variant): a group's identity is
    // part of the result, since "OpenAI at the standard tier" and "whatever
    // the router picked" are different measurements.
    const buckets = new Map<string, ScenarioResult[]>();
    for (const result of results) {
      if (result.execution.mode === "UNAVAILABLE" && !result.execution.ok && result.execution.attempts === 0) continue;
      const key = `${result.execution.group}|${result.execution.provider}|${result.execution.model}|${result.execution.variant}`;
      buckets.set(key, [...(buckets.get(key) ?? []), result]);
    }

    const summaries = [...buckets.values()].map(summarize).sort((a, b) => (b.overall ?? -1) - (a.overall ?? -1));
    const failures = collectFailures(results);
    const status = overallStatus(statuses, summaries);
    const caveats = buildCaveats(config, statuses, results);
    const recommendations = buildRecommendations(summaries, statuses);

    const report = buildReport({
      runId,
      suite: config.suite,
      mode: config.dryRun ? "dry" : "live",
      plannedCalls: units.length,
      commit: commitSha(),
      status,
      statuses,
      summaries,
      results,
      failures,
      recommendations,
      caveats,
    });

    const markdown = renderMarkdown(report, summaries);
    writeReport(config.outDir, runId, report, results);
    writeMarkdown(config.outDir, markdown);

    console.log(`[benchmark] ${budget.requestsUsed} provider call(s) made. Status: ${status}`);
    if (budget.refusedCalls > 0) {
      console.log(
        `[benchmark] ${budget.refusedCalls} call(s) refused by the budget (${budget.reason()}). ` +
          `Refused calls reached no provider and cost nothing; the run is PARTIAL.`,
      );
    }
    if (config.maxCostUsd !== null) {
      console.log(
        `[benchmark] measured spend ${budget.costUsed.toFixed(4)} USD against a ${config.maxCostUsd} USD ceiling` +
          (budget.unpricedCalls > 0
            ? `; ${budget.unpricedCalls} execution(s) were unpriced and could not be charged against it.`
            : "."),
      );
    }
    if (config.dryRun) {
      // Say it at the end, where it is read, and say where the live record
      // still is — the whole point of the redirect is that this run did not
      // touch it (Phase 21 §11).
      console.log("[benchmark] DRY RUN — results are MOCKED; no provider was contacted.");
      console.log(`[benchmark] live artifacts under ${config.outDirBase} were not modified.`);
    }
    console.log(`[benchmark] wrote ${config.outDir}/latest.json and ${config.outDir}/latest.md`);

    return { status, statuses, summaries, results, markdown };
  } finally {
    process.off("SIGINT", onSigint);
  }
}
