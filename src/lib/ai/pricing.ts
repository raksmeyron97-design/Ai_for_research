import type { AIUsage, CostConfidence, TokenUsage } from "./types";

/**
 * Verified provider pricing, USD per 1,000,000 tokens.
 *
 * Every entry was read from the provider's own pricing page on the date in
 * `verifiedOn`, and the page is named in `source`. A model that is not in
 * this table gets no dollar figure at all — `costConfidence: "unverified"` —
 * rather than a plausible-looking number from a default rate. Before Phase
 * 16A the table held three placeholder rates its own comment disowned, and
 * they were wrong by 10-30x: gemini-3.6-flash was listed at $0.075 input
 * against a real $0.75, and gemini-3.5-flash-lite at $0.08 output against a
 * real $2.50 (finding F7).
 *
 * `reasoningBilling` is not decoration. The two providers report thinking
 * tokens differently and getting it wrong mis-bills every reasoning call:
 *
 *  - Gemini's `candidatesTokenCount` EXCLUDES `thoughtsTokenCount` (the SDK
 *    documents totalTokenCount as the sum of prompt + candidates +
 *    toolUsePrompt + thoughts), while the pricing page states output pricing
 *    "includes thinking tokens". So thinking tokens must be ADDED to output
 *    before costing.
 *  - OpenAI's `output_tokens` ALREADY INCLUDES
 *    `output_tokens_details.reasoning_tokens` (the reasoning guide's own
 *    example shows 1024 reasoning inside 1186 output). Adding them again
 *    would double-count.
 *
 * `cachedInputPerMillion` is likewise a discounted rate on a SUBSET of input
 * tokens, not an extra charge: cached tokens are subtracted from the
 * full-price input count.
 */
export interface ModelRate {
  inputPerMillion: number;
  outputPerMillion: number;
  cachedInputPerMillion?: number;
  reasoningBilling: "included_in_output" | "added_to_output";
  /** ISO date the rate was read from `source`. */
  verifiedOn: string;
  source: string;
  /**
   * Last date this rate is valid. Google publishes a scheduled increase for
   * gemini-3.6-flash on 2027-01-01; rather than silently applying a stale
   * price after that, the rate expires and cost falls back to "unverified".
   */
  effectiveUntil?: string;
  notes?: string;
}

const GEMINI_SOURCE = "https://ai.google.dev/gemini-api/docs/pricing";
const OPENAI_SOURCE = "https://developers.openai.com/api/docs/pricing";
const VERIFIED_ON = "2026-09-01";

export const VERIFIED_RATES: Record<string, ModelRate> = {
  // --- Google (Gemini Developer API, paid tier) ---------------------------
  "gemini-3.5-flash-lite": {
    inputPerMillion: 0.3,
    outputPerMillion: 2.5,
    cachedInputPerMillion: 0.03,
    reasoningBilling: "added_to_output",
    verifiedOn: VERIFIED_ON,
    source: GEMINI_SOURCE,
    notes: "Output price includes thinking tokens. Context-cache storage billed separately at $1.00/1M tokens/hour.",
  },
  "gemini-3.6-flash": {
    inputPerMillion: 0.75,
    outputPerMillion: 3.75,
    cachedInputPerMillion: 0.075,
    reasoningBilling: "added_to_output",
    verifiedOn: VERIFIED_ON,
    source: GEMINI_SOURCE,
    effectiveUntil: "2026-12-31",
    notes: "Rises to $1.50 input / $7.50 output on 2027-01-01. Output price includes thinking tokens.",
  },
  "gemini-embedding-001": {
    inputPerMillion: 0.15,
    outputPerMillion: 0,
    reasoningBilling: "included_in_output",
    verifiedOn: VERIFIED_ON,
    source: GEMINI_SOURCE,
    notes: "Embeddings bill on input only.",
  },

  // --- OpenAI (Responses API, standard tier) -----------------------------
  // `gpt-5.6` is an alias: the model guide states it "routes requests to
  // gpt-5.6-sol". It is priced here as sol, which is the expensive end of a
  // 20x spread across the family — see PHASE_16A doc for why pinning an
  // explicit variant is recommended.
  "gpt-5.6": {
    inputPerMillion: 4.0,
    outputPerMillion: 20.0,
    cachedInputPerMillion: 0.4,
    reasoningBilling: "included_in_output",
    verifiedOn: VERIFIED_ON,
    source: OPENAI_SOURCE,
    notes: "Alias for gpt-5.6-sol per the model guide; priced accordingly.",
  },
  "gpt-5.6-sol": {
    inputPerMillion: 4.0,
    outputPerMillion: 20.0,
    cachedInputPerMillion: 0.4,
    reasoningBilling: "included_in_output",
    verifiedOn: VERIFIED_ON,
    source: OPENAI_SOURCE,
  },
  "gpt-5.6-terra": {
    inputPerMillion: 2.0,
    outputPerMillion: 12.0,
    cachedInputPerMillion: 0.2,
    reasoningBilling: "included_in_output",
    verifiedOn: VERIFIED_ON,
    source: OPENAI_SOURCE,
  },
  "gpt-5.6-luna": {
    inputPerMillion: 0.2,
    outputPerMillion: 1.2,
    cachedInputPerMillion: 0.02,
    reasoningBilling: "included_in_output",
    verifiedOn: VERIFIED_ON,
    source: OPENAI_SOURCE,
  },
  "gpt-5.5": {
    inputPerMillion: 5.0,
    outputPerMillion: 30.0,
    cachedInputPerMillion: 0.5,
    reasoningBilling: "included_in_output",
    verifiedOn: VERIFIED_ON,
    source: OPENAI_SOURCE,
    notes: "Rate shown is for context under 272K tokens.",
  },
  "gpt-5.4": {
    inputPerMillion: 2.5,
    outputPerMillion: 15.0,
    cachedInputPerMillion: 0.25,
    reasoningBilling: "included_in_output",
    verifiedOn: VERIFIED_ON,
    source: OPENAI_SOURCE,
    notes: "Rate shown is for context under 272K tokens.",
  },
  "gpt-5.4-mini": {
    inputPerMillion: 0.75,
    outputPerMillion: 4.5,
    cachedInputPerMillion: 0.075,
    reasoningBilling: "included_in_output",
    verifiedOn: VERIFIED_ON,
    source: OPENAI_SOURCE,
  },
};

/** Returns the rate only while it is still in force; an expired rate is not a rate. */
export function getModelRate(model: string, now: Date = new Date()): ModelRate | null {
  const rate = VERIFIED_RATES[model];
  if (!rate) return null;
  if (rate.effectiveUntil && now > new Date(`${rate.effectiveUntil}T23:59:59Z`)) return null;
  return rate;
}

/**
 * Normalizes provider-reported usage into billed quantities and, when the
 * model has a verified rate, a cost breakdown. When it does not, every cost
 * field is left undefined and `costConfidence` is `"unverified"` — the
 * application must never present a dollar amount it cannot stand behind.
 */
export function computeUsageCost(model: string, usage: TokenUsage, now: Date = new Date()): AIUsage {
  const inputTokens = usage.inputTokens ?? 0;
  const outputTokens = usage.outputTokens ?? 0;
  const reasoningTokens = usage.reasoningTokens;
  const cachedInputTokens = usage.cachedInputTokens;

  const base: AIUsage = {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cachedInputTokens,
    totalTokens: usage.totalTokens,
    costConfidence: "unverified",
  };

  const rate = getModelRate(model, now);
  if (!rate) return base;

  // Cached input is a discounted subset of input, not an addition.
  const cached = Math.min(cachedInputTokens ?? 0, inputTokens);
  const fullPriceInput = Math.max(0, inputTokens - cached);

  // Only Gemini reports thinking tokens outside its output count.
  const billedOutput =
    rate.reasoningBilling === "added_to_output" ? outputTokens + (reasoningTokens ?? 0) : outputTokens;
  const billedReasoning = rate.reasoningBilling === "added_to_output" ? (reasoningTokens ?? 0) : 0;

  const perMillion = (tokens: number, price: number) => (tokens / 1_000_000) * price;

  const inputCostUsd = perMillion(fullPriceInput, rate.inputPerMillion);
  const cachedInputCostUsd =
    cached > 0 ? perMillion(cached, rate.cachedInputPerMillion ?? rate.inputPerMillion) : 0;
  const reasoningCostUsd = perMillion(billedReasoning, rate.outputPerMillion);
  const outputCostUsd = perMillion(billedOutput, rate.outputPerMillion) - reasoningCostUsd;

  return {
    ...base,
    inputCostUsd,
    cachedInputCostUsd,
    outputCostUsd,
    reasoningCostUsd,
    totalCostUsd: inputCostUsd + cachedInputCostUsd + outputCostUsd + reasoningCostUsd,
    costConfidence: "verified" satisfies CostConfidence,
  };
}

/** Every model this application prices, for documentation and the benchmark harness. */
export function listVerifiedModels(): string[] {
  return Object.keys(VERIFIED_RATES).sort();
}
