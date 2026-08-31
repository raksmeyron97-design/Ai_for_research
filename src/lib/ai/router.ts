import { AIConfigError } from "./errors";
import { AI_FEATURE_FLAGS, getTierConfig } from "./model-config";
import { GeminiProvider } from "./providers/gemini";
import { OpenAIProvider } from "./providers/openai";
import type { AIProvider, ModelTier, ProviderName, TaskClassification } from "./types";

const PROVIDERS: Record<ProviderName, AIProvider> = {
  gemini: GeminiProvider,
  openai: OpenAIProvider,
};

function isEnabled(provider: ProviderName): boolean {
  return provider === "gemini" ? AI_FEATURE_FLAGS.geminiEnabled : AI_FEATURE_FLAGS.openaiEnabled;
}

function otherProvider(provider: ProviderName): ProviderName {
  return provider === "gemini" ? "openai" : "gemini";
}

export interface RoutingDecision {
  provider: AIProvider;
  providerName: ProviderName;
  model: string;
  tier: ModelTier;
  isFallback: boolean;
}

/**
 * Resolves a task classification to a concrete provider + model, honoring
 * AI_ENABLE_GEMINI / AI_ENABLE_OPENAI feature flags (Section 8). Throws only
 * if neither provider is enabled — that is a deployment misconfiguration,
 * not something to route around silently.
 */
export function resolveProvider(classification: TaskClassification): RoutingDecision {
  const tier = classification.complexity;
  const primary = getTierConfig(tier);

  if (isEnabled(primary.provider)) {
    return {
      provider: PROVIDERS[primary.provider],
      providerName: primary.provider,
      model: primary.model,
      tier,
      isFallback: false,
    };
  }

  const fallbackName = otherProvider(primary.provider);
  if (!isEnabled(fallbackName)) {
    throw new AIConfigError(
      "No AI provider is enabled. Set AI_ENABLE_GEMINI=true and/or AI_ENABLE_OPENAI=true.",
    );
  }

  // Cross-provider fallback for the same tier intent (Section 37): e.g. if
  // Gemini is disabled for a "standard" task, use OpenAI's standard-ish tier.
  const fallbackTier: ModelTier = tier === "advanced" ? "advanced" : "standard";
  const fallbackConfig = getTierConfig(fallbackTier).provider === fallbackName
    ? getTierConfig(fallbackTier)
    : { provider: fallbackName, model: getTierConfig("advanced").model };

  return {
    provider: PROVIDERS[fallbackName],
    providerName: fallbackName,
    model: fallbackConfig.model,
    tier,
    isFallback: true,
  };
}

/** Explicit runtime fallback used by the orchestrator when the primary call itself fails (not disabled, just erroring). */
export function resolveFallback(failedProvider: ProviderName, tier: ModelTier): RoutingDecision | null {
  const fallbackName = otherProvider(failedProvider);
  if (!isEnabled(fallbackName)) return null;

  const fallbackTier: ModelTier = tier === "advanced" ? "advanced" : "standard";
  const config = getTierConfig(fallbackTier).provider === fallbackName
    ? getTierConfig(fallbackTier)
    : { provider: fallbackName, model: getTierConfig("advanced").model };

  return {
    provider: PROVIDERS[fallbackName],
    providerName: fallbackName,
    model: config.model,
    tier,
    isFallback: true,
  };
}

export function getReviewerProvider(): RoutingDecision {
  const config = getTierConfig("reviewer");
  return {
    provider: PROVIDERS[config.provider],
    providerName: config.provider,
    model: config.model,
    tier: "reviewer",
    isFallback: false,
  };
}
