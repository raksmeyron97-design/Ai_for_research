import fs from "node:fs";
import path from "node:path";
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
  /** Per-request wall-clock timeout, enforced by the harness itself. */
  timeoutMs: number;
  retries: number;
  /** smoke = tiny subset for wiring validation; full = whole suite. */
  suite: "smoke" | "full";
  /** Use the deterministic stub provider instead of the network. Results are MOCKED. */
  dryRun: boolean;
  /** Run the LLM-as-judge pass (requires a live provider that is not the one under test). */
  judge: boolean;
  outDir: string;
  /** Path to a JSON file of verified provider rates. Without it, cost is unverified. */
  rateFile: string | null;
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

  return {
    providers,
    models,
    scenarioFilter: list("AI_BENCH_SCENARIOS"),
    categoryFilter: list("AI_BENCH_CATEGORIES"),
    repetitions: Math.max(1, num("AI_BENCH_REPETITIONS", suite === "full" ? 3 : 1)),
    concurrency: Math.max(1, num("AI_BENCH_CONCURRENCY", 2)),
    maxRequests: num("AI_BENCH_MAX_REQUESTS", suite === "full" ? 600 : 12),
    maxScenarios: num("AI_BENCH_MAX_SCENARIOS", suite === "full" ? 200 : 3),
    maxCostUsd: process.env.AI_BENCH_MAX_COST_USD ? num("AI_BENCH_MAX_COST_USD", 5) : null,
    timeoutMs: num("AI_BENCH_TIMEOUT_MS", 90_000),
    retries: Math.max(0, num("AI_BENCH_RETRIES", 1)),
    suite,
    dryRun: bool("AI_BENCH_DRY_RUN", false),
    judge: bool("AI_BENCH_JUDGE", false),
    outDir: process.env.AI_BENCH_OUT_DIR ?? path.join(process.cwd(), "reports", "ai-benchmark"),
    rateFile: process.env.AI_BENCH_RATE_FILE ?? null,
  };
}

export interface ModelRate {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * Cost is only as trustworthy as the rate table behind it. This project has
 * no verified pricing source checked in — `src/lib/ai/token-manager.ts`'s
 * RATE_TABLE is explicitly labelled a placeholder — so unless the operator
 * points AI_BENCH_RATE_FILE at rates they have verified against the
 * providers' own pricing pages, every cost figure is tagged
 * `unverified_placeholder` and must be read as an order-of-magnitude
 * sanity check, not a budget.
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

export function computeCost(
  model: string,
  inputTokens: number | undefined,
  outputTokens: number | undefined,
  rates: Record<string, ModelRate> | null,
): CostAccounting {
  if (inputTokens === undefined && outputTokens === undefined) {
    return { estimatedCostUsd: null, rateSource: "unknown_model" };
  }

  const rate = rates?.[model];
  if (!rate) {
    return { estimatedCostUsd: null, rateSource: rates ? "unknown_model" : "unverified_placeholder" };
  }

  const cost =
    ((inputTokens ?? 0) / 1_000_000) * rate.inputPerMillion +
    ((outputTokens ?? 0) / 1_000_000) * rate.outputPerMillion;

  return { estimatedCostUsd: cost, rateSource: "verified_rate_file" };
}
