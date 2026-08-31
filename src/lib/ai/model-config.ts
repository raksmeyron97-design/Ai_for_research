import { AIConfigError } from "./errors";
import type { ModelTier, ProviderName } from "./types";

interface TierConfig {
  provider: ProviderName;
  model: string;
}

function readModelEnv(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Model IDs are never hard-coded in application logic (Section 7). They are
 * read once here from environment configuration and looked up by tier
 * everywhere else in the app.
 */
function buildModelConfig(): Record<ModelTier, TierConfig> {
  return {
    simple: {
      provider: "gemini",
      model: readModelEnv("GEMINI_FAST_MODEL") ?? "gemini-3.5-flash-lite",
    },
    standard: {
      provider: "gemini",
      model: readModelEnv("GEMINI_STANDARD_MODEL") ?? "gemini-3.6-flash",
    },
    advanced: {
      provider: "openai",
      model: readModelEnv("OPENAI_REASONING_MODEL") ?? "gpt-5.6",
    },
    reviewer: {
      provider: "openai",
      model: readModelEnv("OPENAI_REVIEWER_MODEL") ?? "gpt-5.6",
    },
  };
}

let cachedConfig: Record<ModelTier, TierConfig> | null = null;

export function getModelConfig(): Record<ModelTier, TierConfig> {
  if (!cachedConfig) cachedConfig = buildModelConfig();
  return cachedConfig;
}

export function getTierConfig(tier: ModelTier): TierConfig {
  return getModelConfig()[tier];
}

export const AI_FEATURE_FLAGS = {
  get geminiEnabled() {
    return process.env.AI_ENABLE_GEMINI !== "false";
  },
  get openaiEnabled() {
    return process.env.AI_ENABLE_OPENAI !== "false";
  },
  get defaultProvider(): ProviderName {
    return (process.env.AI_DEFAULT_PROVIDER as ProviderName) ?? "gemini";
  },
  get webGroundingEnabled() {
    return process.env.AI_ENABLE_WEB_GROUNDING === "true";
  },
  get fileSearchEnabled() {
    return process.env.AI_ENABLE_FILE_SEARCH === "true";
  },
  get citationValidationEnabled() {
    return process.env.AI_ENABLE_CITATION_VALIDATION !== "false";
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
