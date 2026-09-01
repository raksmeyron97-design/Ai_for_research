import { AIConfigError } from "./errors";
import { AI_FEATURE_FLAGS, getTierConfig, getTierModelForProvider } from "./model-config";
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

  const model = getTierModelForProvider(tier, fallbackName);
  if (!model) {
    throw new AIConfigError(
      `${primary.provider} is disabled and ${fallbackName} has no model configured for the "${tier}" tier. ` +
        `Set the matching model env var, or re-enable ${primary.provider}.`,
    );
  }

  return {
    provider: PROVIDERS[fallbackName],
    providerName: fallbackName,
    model,
    tier,
    isFallback: true,
  };
}

/**
 * Runtime fallback after the primary call itself failed (as opposed to the
 * provider being disabled). Preserves the task's tier: a `simple` task falls
 * back to the other provider's `simple` model, never to its most capable one.
 *
 * Returns null — meaning "no fallback, report the original failure" — when
 * the other provider is disabled or has no model configured at this tier.
 * Callers attempt this once and never re-enter it, so there is no fallback
 * chain to loop.
 */
export function resolveFallback(failedProvider: ProviderName, tier: ModelTier): RoutingDecision | null {
  const fallbackName = otherProvider(failedProvider);
  if (!isEnabled(fallbackName)) return null;

  const model = getTierModelForProvider(tier, fallbackName);
  if (!model) return null;

  return {
    provider: PROVIDERS[fallbackName],
    providerName: fallbackName,
    model,
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
