import { GeminiProvider } from "@/lib/ai/providers/gemini";
import { OpenAIProvider } from "@/lib/ai/providers/openai";
import type { AIProvider, ProviderName } from "@/lib/ai/types";
import { stripCodeFence } from "./structure";
import type { BenchmarkScenario, JudgeResult, ScenarioResult } from "../types";

/**
 * LLM-as-judge for the dimensions code cannot check: academic usefulness,
 * reasoning quality, Khmer naturalness, citation entailment.
 *
 * Three rules make its output usable rather than decorative:
 *  1. Blind — the judge sees "Response A"/"Response B", never a provider
 *     name (Step 19).
 *  2. Never self-judging — a model is not scored by itself; the judge is
 *     the provider the response did NOT come from.
 *  3. Recorded — judge provider, model, prompt version and criteria go into
 *     every record, because a score is meaningless without them.
 *
 * Judge scores are evidence, not ground truth, and are reported as their own
 * dimension rather than folded into the automated rubric.
 */
export const JUDGE_PROMPT_VERSION = "16.0.0";

export const JUDGE_CRITERIA = [
  "factual_fidelity_to_provided_sources",
  "citation_entailment",
  "research_reasoning_quality",
  "academic_usefulness",
  "language_naturalness",
] as const;

const JUDGE_SCHEMA = {
  type: "object",
  properties: {
    factual_fidelity_to_provided_sources: { type: "number", description: "0-5" },
    citation_entailment: { type: "number", description: "0-5; 5 = every cited source supports the claim it is attached to" },
    research_reasoning_quality: { type: "number", description: "0-5" },
    academic_usefulness: { type: "number", description: "0-5" },
    language_naturalness: { type: "number", description: "0-5" },
    rationale: { type: "string", description: "Two sentences maximum." },
  },
  required: [...JUDGE_CRITERIA, "rationale"],
  additionalProperties: false,
};

const JUDGE_SYSTEM = `You are grading a research-assistant response for an academic thesis support tool.
Score each criterion 0-5, where 0 = unacceptable, 1 = poor, 2 = weak, 3 = acceptable, 4 = strong, 5 = excellent.
Rules:
- Judge only against the evidence block given below. If the response asserts something the evidence does not contain, that lowers factual_fidelity_to_provided_sources regardless of whether the claim is true in general.
- A response that correctly declines to answer because the evidence is insufficient should score HIGH, not low.
- Length is not quality. Do not reward verbosity.
- If a citation is attached to a claim the cited source does not support, citation_entailment must be 2 or below.
Return JSON only.`;

const PROVIDERS: Record<ProviderName, AIProvider> = { gemini: GeminiProvider, openai: OpenAIProvider };

export interface JudgeParams {
  scenario: BenchmarkScenario;
  result: ScenarioResult;
  evidence: string;
  /** Model id to judge with; must not be the model that produced the response. */
  judgeProvider: ProviderName;
  judgeModel: string;
  timeoutMs: number;
}

export async function judgeResponse(params: JudgeParams): Promise<JudgeResult | null> {
  const { scenario, result, evidence, judgeProvider, judgeModel } = params;

  if (judgeProvider === result.execution.provider) return null; // never self-judge
  if (!result.execution.ok) return null;

  const prompt = [
    `# Task given to the assistant\n${scenario.input}`,
    evidence ? `# Evidence the assistant was given\n${evidence}` : "# Evidence the assistant was given\n(none)",
    `# Expected behaviour\n${scenario.expected_behavior}`,
    // Blind: the response is labelled A, with no provider or model name.
    `# Response A\n${result.execution.output}`,
  ].join("\n\n");

  try {
    const response = await PROVIDERS[judgeProvider].generate({
      model: judgeModel,
      systemInstruction: JUDGE_SYSTEM,
      prompt,
      maxOutputTokens: 800,
      responseSchema: JUDGE_SCHEMA,
    });

    const parsed = JSON.parse(stripCodeFence(response.content)) as Record<string, unknown>;
    const scores: Record<string, number> = {};
    for (const criterion of JUDGE_CRITERIA) {
      const value = Number(parsed[criterion]);
      if (Number.isFinite(value)) scores[criterion] = value;
    }

    return {
      judgeProvider,
      judgeModel,
      judgePromptVersion: JUDGE_PROMPT_VERSION,
      criteria: [...JUDGE_CRITERIA],
      scores,
      rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
      blind: true,
    };
  } catch {
    // A judge that failed is recorded as "not judged", never as a zero.
    return null;
  }
}

/** Picks a judge that is not the model under test. Returns null when only one provider is live. */
export function pickJudge(
  responseProvider: ProviderName,
  liveProviders: ProviderName[],
  modelFor: (p: ProviderName) => string | undefined,
): { provider: ProviderName; model: string } | null {
  const other = liveProviders.find((p) => p !== responseProvider);
  if (!other) return null;
  const model = modelFor(other);
  return model ? { provider: other, model } : null;
}
