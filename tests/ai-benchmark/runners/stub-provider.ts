import type { AIProvider, AIResponse, ProviderGenerateRequest, TokenUsage } from "@/lib/ai/types";
import { estimateTokens } from "@/lib/ai/token-manager";

/**
 * Deterministic offline provider. Its only purpose is to prove the
 * harness's own wiring — scenario -> request -> response -> evaluators ->
 * scores -> report — without a network call or a credential.
 *
 * It is NOT a model and it is NOT tuned to pass the suite. Anything it
 * produces is recorded with mode "MOCKED" and must never appear in a
 * quality claim about Gemini or OpenAI. Some scenarios fail against it by
 * design; that a stub scores poorly is evidence the evaluators
 * discriminate, not evidence about any provider.
 */
export const STUB_MODEL_ID = "stub-deterministic-v1";

function bracketKeys(prompt: string): string[] {
  const matches = prompt.matchAll(/\[([a-z][a-z0-9_-]{4,})\]/gi);
  return [...new Set([...matches].map((m) => m[1]))];
}

function jsonForSchema(schema: Record<string, unknown>): string {
  const props = (schema.properties ?? {}) as Record<string, unknown>;

  if ("instrument" in props) {
    return JSON.stringify({
      instrument: {
        name: "Benchmark stub instrument",
        validation_status: "researcher_developed",
        source_reference: "",
        adaptation_notes: "",
      },
      sections: [
        {
          section_label: "Demographics",
          questions: [
            {
              objective_label: "",
              variable_label: "age",
              construct: "demographics",
              question_text: "What is your age in completed years?",
              response_type: "numeric",
              options: [],
              required: true,
            },
          ],
        },
      ],
    });
  }

  if ("scores" in props) {
    return JSON.stringify({
      scores: { methodology: 50, evidence: 50, alignment: 50, writing: 50, references: 50, dataIntegrity: 50, overall: 50 },
      issues: [
        {
          severity: "medium",
          category: "stub",
          section: "",
          message: "Stub response: no social support instrument is described.",
          recommendation: "Add a measure for every exposure named in the objectives.",
        },
      ],
    });
  }

  return JSON.stringify({
    issues: [
      {
        severity: "medium",
        category: "stub",
        section: "",
        message: "Stub response: objective 3 references birth weight, which the methodology does not measure.",
        recommendation: "Remove the objective or add the measurement.",
      },
    ],
  });
}

export const StubProvider: AIProvider = {
  name: "gemini",

  async generate(request: ProviderGenerateRequest): Promise<AIResponse> {
    if (request.responseSchema) {
      const content = jsonForSchema(request.responseSchema);
      return { content, provider: "gemini", model: STUB_MODEL_ID, usage: stubUsage(request.prompt, content) };
    }

    const keys = bracketKeys(request.prompt);
    const cited = keys.length ? `[${keys[0]}]` : "";
    const content = [
      "This is a deterministic stub response used to validate the benchmark pipeline offline.",
      keys.length
        ? `The provided excerpts ${cited} were read but no model reasoned over them.`
        : "No sources were provided in the context.",
      "The provided sources do not contain enough information to answer this question; this response is not model output.",
    ].join(" ");

    return { content, provider: "gemini", model: STUB_MODEL_ID, usage: stubUsage(request.prompt, content) };
  },
};

function stubUsage(prompt: string, output: string): TokenUsage {
  const inputTokens = estimateTokens(prompt);
  const outputTokens = estimateTokens(output);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
}
