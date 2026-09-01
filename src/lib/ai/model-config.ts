import { AIConfigError } from "./errors";
import type { ModelTier, ProviderName } from "./types";

interface TierConfig {
  provider: ProviderName;
  model: string;
}

/**
 * Model per (tier x provider), so a failed call can fall back to the *same
 * tier* on the other provider instead of jumping to whatever that provider's
 * most capable model happens to be.
 *
 * Before Phase 16A there was one model per tier, so `resolveFallback` had
 * nothing same-tier to reach for and fell through to
 * `getTierConfig("advanced")`. A failed `rewrite` — the cheapest task in the
 * app — landed on the reasoning model. With verified pricing that is
 * gemini-3.5-flash-lite at $0.30/$2.50 per 1M failing over to gpt-5.6-sol at
 * $4.00/$20.00: roughly 13x input and 8x output, silently (finding F9).
 *
 * Defaults are model ids verified to be served by this project's own
 * credentials (see reports/ai-benchmark/providers.json). Every cell is
 * env-overridable, and the primary provider for each tier is unchanged from
 * previous phases — this adds the counterpart, it does not re-route
 * anything.
 */
type ModelMatrix = Record<ModelTier, Record<ProviderName, string>>;

function readModelEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Model IDs are never hard-coded in application logic (Section 7). They are
 * read once here from environment configuration and looked up by tier
 * everywhere else in the app.
 */
/** The provider each tier prefers when both are available. Unchanged since Phase 1. */
const TIER_PRIMARY: Record<ModelTier, ProviderName> = {
  simple: "gemini",
  standard: "gemini",
  advanced: "openai",
  reviewer: "openai",
};

/**
 * A matrix cell distinguishes three states, which `readModelEnv` alone
 * cannot: unset (use the default), set (use that model), and *explicitly
 * blanked* (this provider has no model at this tier — do not substitute
 * one). The third is how an operator says "never fall back here", and
 * collapsing it into the default would silently reintroduce F9's
 * substitute-something-else behaviour.
 */
function matrixCell(envName: string, fallback: string): string {
  const raw = process.env[envName];
  if (raw !== undefined && raw.trim().length === 0) return "";
  return raw?.trim() || fallback;
}

function buildModelMatrix(): ModelMatrix {
  return {
    simple: {
      gemini: matrixCell("GEMINI_FAST_MODEL", "gemini-3.5-flash-lite"),
      openai: matrixCell("OPENAI_FAST_MODEL", "gpt-5.6-luna"),
    },
    standard: {
      gemini: matrixCell("GEMINI_STANDARD_MODEL", "gemini-3.6-flash"),
      openai: matrixCell("OPENAI_STANDARD_MODEL", "gpt-5.4-mini"),
    },
    advanced: {
      gemini: matrixCell("GEMINI_ADVANCED_MODEL", "gemini-3.1-pro-preview"),
      openai: matrixCell("OPENAI_REASONING_MODEL", "gpt-5.6"),
    },
    reviewer: {
      gemini: matrixCell("GEMINI_REVIEWER_MODEL", "gemini-3.1-pro-preview"),
      openai: matrixCell("OPENAI_REVIEWER_MODEL", "gpt-5.6"),
    },
  };
}

let cachedMatrix: ModelMatrix | null = null;

export function getModelMatrix(): ModelMatrix {
  if (!cachedMatrix) cachedMatrix = buildModelMatrix();
  return cachedMatrix;
}

/** Test seam: the matrix is cached because env is read once per process. */
export function resetModelConfigCache(): void {
  cachedMatrix = null;
}

export function getModelConfig(): Record<ModelTier, TierConfig> {
  const matrix = getModelMatrix();
  return Object.fromEntries(
    (Object.keys(matrix) as ModelTier[]).map((tier) => [
      tier,
      { provider: TIER_PRIMARY[tier], model: matrix[tier][TIER_PRIMARY[tier]] },
    ]),
  ) as Record<ModelTier, TierConfig>;
}

export function getTierConfig(tier: ModelTier): TierConfig {
  return { provider: TIER_PRIMARY[tier], model: getModelMatrix()[tier][TIER_PRIMARY[tier]] };
}

/**
 * The model to use for a tier on a specific provider. Returns null when the
 * operator has explicitly blanked that cell, which is how a deployment says
 * "this provider has nothing suitable at this tier" — the router then
 * declines to fall back rather than substituting a differently-priced model.
 */
export function getTierModelForProvider(tier: ModelTier, provider: ProviderName): string | null {
  return getModelMatrix()[tier][provider] || null;
}

/**
 * Provider kill switches. These are the only two AI flags that do anything;
 * the Phase 16A audit removed `AI_DEFAULT_PROVIDER`, `AI_ENABLE_WEB_GROUNDING`,
 * `AI_ENABLE_FILE_SEARCH` and `AI_ENABLE_CITATION_VALIDATION`, which had
 * getters that nothing called (findings F4/F5). Configuration that silently
 * does nothing is worse than no configuration during an incident.
 */
export const AI_FEATURE_FLAGS = {
  get geminiEnabled() {
    return process.env.AI_ENABLE_GEMINI !== "false";
  },
  get openaiEnabled() {
    return process.env.AI_ENABLE_OPENAI !== "false";
  },
};

export function getMaxOutputTokens(): number {
  const raw = readModelEnv("AI_MAX_OUTPUT_TOKENS");
  return raw ? Number(raw) : 2048;
}

export function getMaxContextTokens(): number {
  const raw = readModelEnv("AI_MAX_CONTEXT_TOKENS");
  return raw ? Number(raw) : 32_000;
}

/** Embeddings aren't a chat/generation task, so they don't go through TASK_META tiers — one dedicated model. */
export function getEmbeddingModel(): string {
  return readModelEnv("GEMINI_EMBEDDING_MODEL") ?? "gemini-embedding-001";
}

/** Must match the `vector(N)` column width in supabase/migrations/*_phase3_document_chunks.sql. */
export function getEmbeddingDimensions(): number {
  const raw = readModelEnv("GEMINI_EMBEDDING_DIMENSIONS");
  return raw ? Number(raw) : 768;
}

export function requireApiKey(provider: ProviderName): string {
  const key =
    provider === "gemini"
      ? process.env.GEMINI_API_KEY
      : process.env.OPENAI_API_KEY;
  if (!key) {
    throw new AIConfigError(
      `${provider.toUpperCase()}_API_KEY is not set. Configure it in .env (server-side only, never exposed to the client).`,
    );
  }
  return key;
}
