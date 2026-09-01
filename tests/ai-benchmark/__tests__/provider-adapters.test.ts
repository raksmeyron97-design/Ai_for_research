import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Provider adapter + token-extraction tests for the PRODUCTION adapters in
 * `src/lib/ai/providers/`. The SDKs are mocked, so these are unit tests of
 * the mapping layer and nothing more — they are explicitly NOT live
 * provider validation and must never be cited as evidence that a provider
 * works end to end.
 *
 * What they do establish: the shape the benchmark's token accounting
 * depends on, including the reasoning/cached token capture added in
 * Phase 16 so thinking-model usage is measurable at all.
 */

const geminiGenerate = vi.fn();
const openaiCreate = vi.fn();

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: geminiGenerate, generateContentStream: vi.fn(), embedContent: vi.fn() };
  },
}));

vi.mock("openai", () => ({
  default: class {
    responses = { create: openaiCreate };
  },
}));

beforeEach(() => {
  vi.resetModules();
  geminiGenerate.mockReset();
  openaiCreate.mockReset();
  process.env.GEMINI_API_KEY = "test-key-not-real";
  process.env.OPENAI_API_KEY = "test-key-not-real";
});

describe("Gemini adapter", () => {
  it("normalises a response and maps Gemini's usage field names", async () => {
    geminiGenerate.mockResolvedValue({
      text: "answer",
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 45, totalTokenCount: 165 },
    });

    const { GeminiProvider } = await import("@/lib/ai/providers/gemini");
    const response = await GeminiProvider.generate({ model: "gemini-test", prompt: "p" });

    expect(response.content).toBe("answer");
    expect(response.provider).toBe("gemini");
    expect(response.model).toBe("gemini-test");
    expect(response.usage).toEqual({
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
      reasoningTokens: undefined,
      cachedInputTokens: undefined,
    });
  });

  it("returns empty content rather than undefined when the model returns no text", async () => {
    geminiGenerate.mockResolvedValue({ text: undefined, usageMetadata: undefined });
    const { GeminiProvider } = await import("@/lib/ai/providers/gemini");
    const response = await GeminiProvider.generate({ model: "gemini-test", prompt: "p" });
    expect(response.content).toBe("");
    expect(response.usage).toBeUndefined();
  });

  it("captures thoughtsTokenCount, which input+output alone does not account for", async () => {
    geminiGenerate.mockResolvedValue({
      text: "answer",
      usageMetadata: {
        promptTokenCount: 100,
        candidatesTokenCount: 50,
        thoughtsTokenCount: 400,
        totalTokenCount: 550,
      },
    });

    const { GeminiProvider } = await import("@/lib/ai/providers/gemini");
    const response = await GeminiProvider.generate({ model: "gemini-test", prompt: "p" });

    // input + output (150) does not reconcile with the provider's own total
    // (550) for a thinking model. Phase 16 captures the 400 thinking tokens
    // so the gap is visible; calculateCost() still bills input+output only,
    // which under-counts here — see the report's cost section.
    expect(response.usage?.reasoningTokens).toBe(400);
    expect(response.usage?.totalTokens).toBe(550);
    expect((response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0)).toBe(150);
  });

  it("wraps a provider error as a retryable AIProviderError", async () => {
    geminiGenerate.mockRejectedValue(new Error("upstream 503"));
    const { GeminiProvider } = await import("@/lib/ai/providers/gemini");
    const { AIProviderError } = await import("@/lib/ai/errors");
    await expect(GeminiProvider.generate({ model: "m", prompt: "p" })).rejects.toBeInstanceOf(AIProviderError);
  });

  it("converts a JSON Schema to Gemini's uppercase-type dialect when a schema is requested", async () => {
    geminiGenerate.mockResolvedValue({ text: "{}", usageMetadata: undefined });
    const { GeminiProvider } = await import("@/lib/ai/providers/gemini");
    await GeminiProvider.generate({
      model: "m",
      prompt: "p",
      responseSchema: { type: "object", properties: { a: { type: "string" } } },
    });

    const config = geminiGenerate.mock.calls[0][0].config;
    expect(config.responseMimeType).toBe("application/json");
    expect(config.responseSchema.type).toBe("OBJECT");
    expect(config.responseSchema.properties.a.type).toBe("STRING");
  });
});

describe("OpenAI adapter", () => {
  it("normalises a Responses API result and maps input/output token names", async () => {
    openaiCreate.mockResolvedValue({
      output_text: "answer",
      usage: { input_tokens: 200, output_tokens: 80, total_tokens: 280 },
    });

    const { OpenAIProvider } = await import("@/lib/ai/providers/openai");
    const response = await OpenAIProvider.generate({ model: "gpt-test", prompt: "p" });

    expect(response.content).toBe("answer");
    expect(response.provider).toBe("openai");
    expect(response.usage).toEqual({
      inputTokens: 200,
      outputTokens: 80,
      totalTokens: 280,
      reasoningTokens: undefined,
      cachedInputTokens: undefined,
    });
  });

  it("captures reasoning_tokens and cached_tokens from usage details", async () => {
    openaiCreate.mockResolvedValue({
      output_text: "answer",
      usage: {
        input_tokens: 200,
        output_tokens: 80,
        total_tokens: 280,
        input_tokens_details: { cached_tokens: 150, cache_write_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 640 },
      },
    });

    const { OpenAIProvider } = await import("@/lib/ai/providers/openai");
    const response = await OpenAIProvider.generate({ model: "gpt-test", prompt: "p" });

    // Cached input is billed at a reduced rate and reasoning tokens are
    // billed as output. Both are now recorded, so a cost model can account
    // for them; calculateCost() does not yet, which the report flags.
    expect(response.usage).toEqual({
      inputTokens: 200,
      outputTokens: 80,
      totalTokens: 280,
      reasoningTokens: 640,
      cachedInputTokens: 150,
    });
  });

  it("sends structured output as a strict json_schema text format", async () => {
    openaiCreate.mockResolvedValue({ output_text: "{}", usage: undefined });
    const { OpenAIProvider } = await import("@/lib/ai/providers/openai");
    await OpenAIProvider.generate({
      model: "m",
      prompt: "p",
      responseSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
    });

    const params = openaiCreate.mock.calls[0][0];
    expect(params.text.format.type).toBe("json_schema");
    expect(params.text.format.strict).toBe(true);
  });

  it("has no countTokens endpoint and says so rather than guessing", async () => {
    const { OpenAIProvider } = await import("@/lib/ai/providers/openai");
    await expect(OpenAIProvider.countTokens?.({ model: "m", text: "t" })).rejects.toThrow(/does not support countTokens/);
  });
});
