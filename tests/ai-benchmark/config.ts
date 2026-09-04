import fs from "node:fs";
import path from "node:path";
import { getModelRate } from "@/lib/ai/pricing";
import type { ProviderName } from "@/lib/ai/types";
import type { CostAccounting } from "./types";

/**
 * Everything the benchmark run is allowed to do, in one place. Defaults are
 * deliberately conservative: a bare `npm run ai:benchmark` runs the smoke
 * suite, not the full one, so the first live invocation cannot spend real
 * money by surprise (Step 28).
 */
export interface BenchmarkConfig {
  providers: ProviderName[];
  /** Explicit model ids to test, keyed by provider. Empty = use the app's configured tier models. */
  models: Partial<Record<ProviderName, string[]>>;
  scenarioFilter: string[] | null;
  categoryFilter: string[] | null;
  repetitions: number;
  concurrency: number;
  /** Hard ceiling on total provider calls for the whole run. */
  maxRequests: number;
  /** Hard ceiling on distinct scenarios. */
  maxScenarios: number;
  /** Abort the run once estimated spend crosses this. null = no cost ceiling (only request ceiling). */
  maxCostUsd: number | null;
  /**
   * Harness backstop around a whole scenario. It must exceed the
   * orchestrator's own budget, not undercut it: production allows one retry
   * at 45s plus a cross-provider fallback at the same, so a legitimate slow
   * scenario can run ~180s. A tighter value here would record production's
   * normal recovery behaviour as a harness timeout.
   */
  timeoutMs: number;
  retries: number;
  /** smoke = tiny subset for wiring validation; full = whole suite. */
  suite: "smoke" | "full";
  /** Use the deterministic stub provider instead of the network. Results are MOCKED. */
  dryRun: boolean;
  /** Run the LLM-as-judge pass (requires a live provider that is not the one under test). */
  judge: boolean;
  /**
   * Where this run's artifacts go. Derived, never taken raw from the
   * environment: a dry run is always redirected into a `dry/` subdirectory of
   * the base (see `resolveOutDir`).
   */
  outDir: string;
  /** The base the run was pointed at, before the dry-run redirect. Reported so
   *  a reader can see both halves of the decision. */
  outDirBase: string;
  /** Path to a JSON file of verified provider rates. Without it, cost is unverified. */
  rateFile: string | null;
}

/**
 * Keep a mocked run's artifacts away from the live ones (Phase 21 §9, §11).
 *
 * `ai:benchmark:dry` used to write `latest.json` and `latest.md` into the same
 * directory a live run writes them, so running the dry gate overwrote the
 * committed provider record with a stub report. That is a footgun in the worst
 * possible place: the overwrite is silent, it succeeds, and the file it
 * destroys is evidence about real provider behaviour that cannot be
 * regenerated without spending money. Phase 20 hit it and had to discard the
 * overwrite by hand before committing.
 *
 * The redirect is applied to `AI_BENCH_OUT_DIR` as well as to the default, not
 * only to the default. An operator who points the harness at their own
 * directory has the same live record to lose, and "the safety only applies if
 * you did not configure anything" is not a safety property.
 *
 * The live path is deliberately left exactly where it has always been. Moving
 * it would rewrite where historical evidence lives to make the tree symmetric,
 * and §61 is explicit that historical benchmark evidence is preserved rather
 * than tidied.
 */
export function resolveOutDir(base: string, dryRun: boolean): string {
  return dryRun ? path.join(base, "dry") : base;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function list(name: string): string[] | null {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return null;
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

export function loadConfig(): BenchmarkConfig {
  const providers = (list("AI_BENCH_PROVIDERS") ?? ["gemini", "openai"]).filter(
    (p): p is ProviderName => p === "gemini" || p === "openai",
  );

  const models: Partial<Record<ProviderName, string[]>> = {};
  const geminiModels = list("AI_BENCH_GEMINI_MODELS");
  const openaiModels = list("AI_BENCH_OPENAI_MODELS");
  if (geminiModels) models.gemini = geminiModels;
  if (openaiModels) models.openai = openaiModels;

  const suite = process.env.AI_BENCH_SUITE === "full" ? "full" : "smoke";
  const dryRun = bool("AI_BENCH_DRY_RUN", false);
  const outDirBase =
    process.env.AI_BENCH_OUT_DIR ?? path.join(process.cwd(), "reports", "ai-benchmark");

  return {
    providers,
    models,
    scenarioFilter: list("AI_BENCH_SCENARIOS"),
    categoryFilter: list("AI_BENCH_CATEGORIES"),
    repetitions: Math.max(1, num("AI_BENCH_REPETITIONS", suite === "full" ? 3 : 1)),
    concurrency: Math.max(1, num("AI_BENCH_CONCURRENCY", 2)),
    // Ceilings count PROVIDER CALLS, not scenario runs. Since Phase 16B each
    // run drives the full production path, so one scenario can cause several
    // calls: a retry, a cross-provider fallback, and the dual-model reviewer
    // pass on high-risk advanced tasks. The smoke default leaves room for
    // that on top of its ~9 runs.
    maxRequests: num("AI_BENCH_MAX_REQUESTS", suite === "full" ? 1800 : 24),
    maxScenarios: num("AI_BENCH_MAX_SCENARIOS", suite === "full" ? 200 : 3),
    maxCostUsd: process.env.AI_BENCH_MAX_COST_USD ? num("AI_BENCH_MAX_COST_USD", 5) : null,
    timeoutMs: num("AI_BENCH_TIMEOUT_MS", 240_000),
    retries: Math.max(0, num("AI_BENCH_RETRIES", 1)),
    suite,
    dryRun,
    judge: bool("AI_BENCH_JUDGE", false),
    outDirBase,
    outDir: resolveOutDir(outDirBase, dryRun),
    rateFile: process.env.AI_BENCH_RATE_FILE ?? null,
  };
}

export interface ModelRate {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * An operator-supplied rate file, which overrides the in-repo verified rates.
 * Useful for enterprise/negotiated pricing, or to price a model
 * `src/lib/ai/pricing.ts` does not yet cover.
 */
export function loadRates(rateFile: string | null): Record<string, ModelRate> | null {
  if (!rateFile) return null;
  const resolved = path.resolve(rateFile);
  if (!fs.existsSync(resolved)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(resolved, "utf8")) as Record<string, ModelRate>;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Cost for one benchmark call.
 *
 * Since Phase 16A the application carries verified provider rates
 * (`src/lib/ai/pricing.ts`, each entry sourced and dated), so the benchmark
 * prices runs by default instead of reporting nothing. An operator rate file
 * still wins where supplied. A model neither source prices gets no dollar
 * figure at all — never a default-rate guess.
 */
export function computeCost(
  model: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  rates: Record<string, ModelRate> | null,
): CostAccounting {
  if (inputTokens === undefined && outputTokens === undefined) {
    return { estimatedCostUsd: null, rateSource: "unknown_model" };
  }

  const perMillion = (tokens: number | undefined, price: number) => ((tokens ?? 0) / 1_000_000) * price;

  const override = rates?.[model];
  if (override) {
    return {
      estimatedCostUsd:
        perMillion(inputTokens, override.inputPerMillion) + perMillion(outputTokens, override.outputPerMillion),
      rateSource: "verified_rate_file",
    };
  }

  const verified = getModelRate(model);
  if (verified) {
    return {
      estimatedCostUsd:
        perMillion(inputTokens, verified.inputPerMillion) + perMillion(outputTokens, verified.outputPerMillion),
      rateSource: "verified_app_pricing",
    };
  }

  return { estimatedCostUsd: null, rateSource: "unknown_model" };
}
