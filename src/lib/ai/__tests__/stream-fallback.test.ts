import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AIStreamIdleTimeoutError } from "../stream-guard";
import type { AIChunk } from "../types";

/**
 * Orchestrator-level streaming behaviour: idle-gap timeout, and the rule that
 * governs whether a stalled stream may be retried on the other provider.
 *
 * The rule is not "always fall back". Once a chunk has reached the client,
 * restarting on another provider would replay the answer from the beginning,
 * duplicating the text the reader already has. So fallback is allowed only
 * when nothing has been emitted — otherwise the failure is reported honestly.
 */
const geminiStream = vi.hoisted(() => vi.fn());
const openaiStream = vi.hoisted(() => vi.fn());

vi.mock("../providers/gemini", () => ({
  GeminiProvider: { name: "gemini", generate: vi.fn(), stream: geminiStream },
}));
vi.mock("../providers/openai", () => ({
  OpenAIProvider: { name: "openai", generate: vi.fn(), stream: openaiStream },
}));

const { AIOrchestrator } = await import("../orchestrator");
const { resetModelConfigCache } = await import("../model-config");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function insertSpy() {
  const insert = vi.fn(async (_row: Record<string, unknown>) => ({ error: null }));
  return { insert, supabase: { from: () => ({ insert }) } as never };
}

async function collect(iterable: AsyncIterable<AIChunk>) {
  const out: AIChunk[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

const request = { projectId: "p1", taskType: "chat" as const, message: "hi" };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.AI_STREAM_IDLE_TIMEOUT_MS = "50";
  delete process.env.AI_ENABLE_GEMINI;
  delete process.env.AI_ENABLE_OPENAI;
  resetModelConfigCache();
});

afterEach(() => {
  delete process.env.AI_STREAM_IDLE_TIMEOUT_MS;
  delete process.env.AI_ENABLE_OPENAI;
  resetModelConfigCache();
});

describe("streaming idle timeout in the orchestrator", () => {
  it("streams a normal response through", async () => {
    geminiStream.mockImplementation(async function* () {
      yield { delta: "hello ", done: false };
      yield { delta: "world", done: true };
    });

    const chunks = await collect(new AIOrchestrator().stream(request));
    expect(chunks.map((c) => c.delta).join("")).toBe("hello world");
  });

  it("does not time out a slow but continuous stream", async () => {
    geminiStream.mockImplementation(async function* () {
      for (let i = 0; i < 5; i += 1) {
        await sleep(25); // under the 50ms idle budget, but 125ms in total
        yield { delta: `${i}`, done: false };
      }
    });

    const chunks = await collect(new AIOrchestrator().stream(request));
    expect(chunks).toHaveLength(5);
  });

  it("falls back to the other provider when the primary stalls before emitting anything", async () => {
    geminiStream.mockImplementation(async function* (): AsyncGenerator<AIChunk> {
      await sleep(5_000);
      yield { delta: "never", done: false };
    });
    openaiStream.mockImplementation(async function* () {
      yield { delta: "fallback answer", done: true };
    });

    const chunks = await collect(new AIOrchestrator().stream(request));

    expect(chunks.map((c) => c.delta).join("")).toBe("fallback answer");
    expect(openaiStream).toHaveBeenCalledTimes(1);
  });

  it("uses the SAME TIER model for the stream fallback, not the advanced one", async () => {
    geminiStream.mockImplementation(async function* (): AsyncGenerator<AIChunk> {
      await sleep(5_000);
      yield { delta: "never", done: false };
    });
    openaiStream.mockImplementation(async function* () {
      yield { delta: "ok", done: true };
    });

    // "rewrite" is a simple-tier task.
    await collect(new AIOrchestrator().stream({ ...request, taskType: "rewrite" }));

    expect(openaiStream.mock.calls[0][0].model).toBe("gpt-5.6-luna");
  });

  it("does NOT fall back once output has already reached the client", async () => {
    geminiStream.mockImplementation(async function* (): AsyncGenerator<AIChunk> {
      yield { delta: "partial answer", done: false };
      await sleep(5_000);
      yield { delta: "never", done: false };
    });
    openaiStream.mockImplementation(async function* () {
      yield { delta: "would duplicate", done: true };
    });

    const received: AIChunk[] = [];
    await expect(
      (async () => {
        for await (const chunk of new AIOrchestrator().stream(request)) received.push(chunk);
      })(),
    ).rejects.toBeInstanceOf(AIStreamIdleTimeoutError);

    expect(received.map((c) => c.delta)).toEqual(["partial answer"]);
    expect(openaiStream).not.toHaveBeenCalled();
  });

  it("reports the failure when there is nowhere to fall back to", async () => {
    process.env.AI_ENABLE_OPENAI = "false";
    resetModelConfigCache();
    geminiStream.mockImplementation(async function* (): AsyncGenerator<AIChunk> {
      await sleep(5_000);
      yield { delta: "never", done: false };
    });

    await expect(collect(new AIOrchestrator().stream(request))).rejects.toBeInstanceOf(AIStreamIdleTimeoutError);
    expect(openaiStream).not.toHaveBeenCalled();
  });
});

describe("usage recording on the streaming path", () => {
  it("records a stall as a failure, never as a partial success", async () => {
    process.env.AI_ENABLE_OPENAI = "false";
    resetModelConfigCache();
    geminiStream.mockImplementation(async function* (): AsyncGenerator<AIChunk> {
      yield { delta: "partial", done: false };
      await sleep(5_000);
    });

    const { insert, supabase } = insertSpy();
    await expect(
      collect(new AIOrchestrator({ supabase }).stream(request)),
    ).rejects.toBeInstanceOf(AIStreamIdleTimeoutError);

    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert.mock.calls[0][0].success).toBe(false);
  });

  it("records both the failed primary and the successful fallback", async () => {
    geminiStream.mockImplementation(async function* (): AsyncGenerator<AIChunk> {
      await sleep(5_000);
    });
    openaiStream.mockImplementation(async function* () {
      yield { delta: "ok", done: true, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
    });

    const { insert, supabase } = insertSpy();
    await collect(new AIOrchestrator({ supabase }).stream(request));

    expect(insert).toHaveBeenCalledTimes(2);
    expect(insert.mock.calls[0][0]).toMatchObject({ provider: "gemini", success: false });
    expect(insert.mock.calls[1][0]).toMatchObject({ provider: "openai", success: true, fallback: true });
  });

  it("keeps provider-measured tokens on the fallback attempt", async () => {
    geminiStream.mockImplementation(async function* (): AsyncGenerator<AIChunk> {
      await sleep(5_000);
    });
    openaiStream.mockImplementation(async function* () {
      yield { delta: "ok", done: true, usage: { inputTokens: 900, outputTokens: 40, totalTokens: 940 } };
    });

    const { insert, supabase } = insertSpy();
    await collect(new AIOrchestrator({ supabase }).stream(request));

    expect(insert.mock.calls[1][0]).toMatchObject({ input_tokens: 900, tokens_measured: true });
  });
});
