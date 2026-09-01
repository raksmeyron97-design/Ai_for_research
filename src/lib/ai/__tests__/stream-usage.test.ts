import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 16 finding F6: neither streaming adapter surfaced provider usage
 * metadata, so `AIOrchestrator.stream()` fell back to estimating tokens from
 * text length. `/api/ai/chat` is the streaming route, so the majority of
 * `ai_usage` rows — and the admin cost dashboard built on them — were
 * estimates presented as measurements.
 */
const { geminiStream, openaiCreate } = vi.hoisted(() => ({
  geminiStream: vi.fn(),
  openaiCreate: vi.fn(),
}));

vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: vi.fn(), generateContentStream: geminiStream, embedContent: vi.fn() };
  },
}));

vi.mock("openai", () => ({
  default: class {
    responses = { create: openaiCreate };
  },
}));

async function* asyncIterable<T>(items: T[]) {
  for (const item of items) yield item;
}

async function collect(iterable: AsyncIterable<{ delta: string; done: boolean; usage?: unknown }>) {
  const chunks = [];
  for await (const chunk of iterable) chunks.push(chunk);
  return chunks;
}

beforeEach(() => {
  vi.resetModules();
  geminiStream.mockReset();
  openaiCreate.mockReset();
  process.env.GEMINI_API_KEY = "test-key-not-real";
  process.env.OPENAI_API_KEY = "test-key-not-real";
});

describe("Gemini streaming usage", () => {
  it("reports the provider's usage on the final chunk", async () => {
    geminiStream.mockResolvedValue(
      asyncIterable([
        { text: "Prevalence ", usageMetadata: undefined },
        { text: "was 21.4%.", usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40, totalTokenCount: 940 } },
      ]),
    );

    const { GeminiProvider } = await import("../providers/gemini");
    const chunks = await collect(GeminiProvider.stream!({ model: "m", prompt: "p" }));

    const done = chunks.at(-1)!;
    expect(done.done).toBe(true);
    expect(done.usage).toMatchObject({ inputTokens: 900, outputTokens: 40, totalTokens: 940 });
  });

  it("keeps the last usage report, not the first partial one", async () => {
    geminiStream.mockResolvedValue(
      asyncIterable([
        { text: "a", usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 5, totalTokenCount: 905 } },
        { text: "b", usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 40, totalTokenCount: 940 } },
      ]),
    );

    const { GeminiProvider } = await import("../providers/gemini");
    const chunks = await collect(GeminiProvider.stream!({ model: "m", prompt: "p" }));

    expect(chunks.at(-1)!.usage).toMatchObject({ outputTokens: 40 });
  });

  it("leaves usage undefined when the provider reported none", async () => {
    geminiStream.mockResolvedValue(asyncIterable([{ text: "a", usageMetadata: undefined }]));
    const { GeminiProvider } = await import("../providers/gemini");
    const chunks = await collect(GeminiProvider.stream!({ model: "m", prompt: "p" }));
    expect(chunks.at(-1)!.usage).toBeUndefined();
  });
});

describe("OpenAI streaming usage", () => {
  it("reports usage from response.completed", async () => {
    openaiCreate.mockResolvedValue(
      asyncIterable([
        { type: "response.output_text.delta", delta: "Prevalence was 21.4%." },
        { type: "response.completed", response: { usage: { input_tokens: 900, output_tokens: 40, total_tokens: 940 } } },
      ]),
    );

    const { OpenAIProvider } = await import("../providers/openai");
    const chunks = await collect(OpenAIProvider.stream!({ model: "m", prompt: "p" }));

    expect(chunks.at(-1)!.usage).toMatchObject({ inputTokens: 900, outputTokens: 40 });
  });

  it("reports usage for a truncated response, which is still billed", async () => {
    openaiCreate.mockResolvedValue(
      asyncIterable([
        { type: "response.output_text.delta", delta: "cut off mid-" },
        { type: "response.incomplete", response: { usage: { input_tokens: 900, output_tokens: 2048, total_tokens: 2948 } } },
      ]),
    );

    const { OpenAIProvider } = await import("../providers/openai");
    const chunks = await collect(OpenAIProvider.stream!({ model: "m", prompt: "p" }));

    const done = chunks.at(-1)!;
    expect(done.done).toBe(true);
    expect(done.usage).toMatchObject({ outputTokens: 2048 });
  });

  it("throws on response.failed instead of ending silently", async () => {
    openaiCreate.mockResolvedValue(
      asyncIterable([
        { type: "response.output_text.delta", delta: "partial" },
        { type: "response.failed", response: { error: { message: "server error" } } },
      ]),
    );

    const { OpenAIProvider } = await import("../providers/openai");
    const { AIProviderError } = await import("../errors");

    await expect(collect(OpenAIProvider.stream!({ model: "m", prompt: "p" }))).rejects.toBeInstanceOf(
      AIProviderError,
    );
  });
});

describe("AIOrchestrator.stream records measured usage", () => {
  it("uses provider usage rather than a length estimate", async () => {
    geminiStream.mockResolvedValue(
      asyncIterable([
        { text: "short", usageMetadata: { promptTokenCount: 4000, candidatesTokenCount: 12, totalTokenCount: 4012 } },
      ]),
    );

    const insert = vi.fn(async (_row: Record<string, unknown>) => ({ error: null }));
    const supabase = { from: () => ({ insert }) } as never;

    const { AIOrchestrator } = await import("../orchestrator");
    await collect(
      new AIOrchestrator({ supabase }).stream({
        projectId: "p1",
        taskType: "chat",
        message: "hi",
      }),
    );

    const row = insert.mock.calls[0][0];
    // A length estimate of "short" would be ~2 output tokens and a prompt
    // estimate nowhere near 4000 — these are the provider's numbers.
    expect(row.input_tokens).toBe(4000);
    expect(row.output_tokens).toBe(12);
    expect(row.tokens_measured).toBe(true);
  });

  it("falls back to an estimate and flags it when the provider reports nothing", async () => {
    geminiStream.mockResolvedValue(asyncIterable([{ text: "some output text", usageMetadata: undefined }]));

    const insert = vi.fn(async (_row: Record<string, unknown>) => ({ error: null }));
    const supabase = { from: () => ({ insert }) } as never;

    const { AIOrchestrator } = await import("../orchestrator");
    await collect(
      new AIOrchestrator({ supabase }).stream({ projectId: "p1", taskType: "chat", message: "hi" }),
    );

    const row = insert.mock.calls[0][0];
    expect(row.tokens_measured).toBe(false);
    expect(row.output_tokens).toBeGreaterThan(0);
  });

  it("still records whatever usage arrived before a mid-stream failure", async () => {
    async function* failing() {
      yield { text: "partial", usageMetadata: { promptTokenCount: 500, candidatesTokenCount: 3, totalTokenCount: 503 } };
      throw new Error("connection reset");
    }
    geminiStream.mockResolvedValue(failing());

    const insert = vi.fn(async (_row: Record<string, unknown>) => ({ error: null }));
    const supabase = { from: () => ({ insert }) } as never;

    const { AIOrchestrator } = await import("../orchestrator");
    await expect(
      collect(new AIOrchestrator({ supabase }).stream({ projectId: "p1", taskType: "chat", message: "hi" })),
    ).rejects.toThrow();

    const row = insert.mock.calls[0][0];
    expect(row.success).toBe(false);
    expect(row.input_tokens).toBe(500);
    expect(row.tokens_measured).toBe(true);
  });
});
