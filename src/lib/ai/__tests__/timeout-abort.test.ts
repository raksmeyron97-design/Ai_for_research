import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIProviderError, AITimeoutError, withRetry } from "../errors";

// vi.mock is hoisted above every other statement in the file, so the spies
// its factories close over must be created with vi.hoisted rather than
// declared in a describe block.
const { geminiGenerate, openaiCreate } = vi.hoisted(() => ({
  geminiGenerate: vi.fn(),
  openaiCreate: vi.fn(),
}));

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

/**
 * Regression tests for Phase 16 finding F1: `withRetry` created an
 * AbortController, started a timer, and passed the signal to a callback that
 * neither provider adapter forwarded to its SDK. The timer fired, nothing
 * listened, and the call hung indefinitely.
 */
describe("withRetry timeout enforcement", () => {
  it("rejects with AITimeoutError when the callback never settles", async () => {
    const start = Date.now();
    await expect(
      withRetry(() => new Promise(() => {}), { retries: 0, timeoutMs: 40 }),
    ).rejects.toBeInstanceOf(AITimeoutError);
    // The point of the fix: it returns rather than hanging.
    expect(Date.now() - start).toBeLessThan(2000);
  });

  it("aborts the signal it hands the callback, so an SDK can cancel its request", async () => {
    let observed: AbortSignal | undefined;
    await expect(
      withRetry(
        (signal) => {
          observed = signal;
          return new Promise(() => {});
        },
        { retries: 0, timeoutMs: 30 },
      ),
    ).rejects.toBeInstanceOf(AITimeoutError);

    expect(observed?.aborted).toBe(true);
  });

  it("still resolves normally and does not leave a pending timer", async () => {
    await expect(withRetry(async () => "done", { retries: 0, timeoutMs: 1000 })).resolves.toBe("done");
  });

  it("aborts the signal after a successful call so the socket is released", async () => {
    let observed: AbortSignal | undefined;
    await withRetry(
      async (signal) => {
        observed = signal;
        return "done";
      },
      { retries: 0, timeoutMs: 1000 },
    );
    expect(observed?.aborted).toBe(true);
  });

  it("gives each retry attempt its own signal", async () => {
    const signals: AbortSignal[] = [];
    await expect(
      withRetry(
        async (signal) => {
          signals.push(signal);
          throw new AIProviderError("gemini", "transient", true);
        },
        { retries: 1, timeoutMs: 1000, baseDelayMs: 1 },
      ),
    ).rejects.toBeInstanceOf(AIProviderError);

    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });

  it("does not retry a non-retryable provider error", async () => {
    const fn = vi.fn(async () => {
      throw new AIProviderError("openai", "bad request", false);
    });
    await expect(withRetry(fn, { retries: 2, timeoutMs: 1000, baseDelayMs: 1 })).rejects.toBeInstanceOf(
      AIProviderError,
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries a timeout, since a hung connection is usually transient", async () => {
    let calls = 0;
    const result = await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) return new Promise<string>(() => {}); // hangs, times out
        return "second attempt";
      },
      { retries: 1, timeoutMs: 30, baseDelayMs: 1 },
    );
    expect(calls).toBe(2);
    expect(result).toBe("second attempt");
  });
});

describe("adapters forward the signal to their SDK", () => {
  beforeEach(() => {
    vi.resetModules();
    geminiGenerate.mockReset();
    openaiCreate.mockReset();
    process.env.GEMINI_API_KEY = "test-key-not-real";
    process.env.OPENAI_API_KEY = "test-key-not-real";
  });

  it("passes the signal to Gemini as config.abortSignal", async () => {
    geminiGenerate.mockResolvedValue({ text: "ok", usageMetadata: undefined });
    const { GeminiProvider } = await import("../providers/gemini");
    const signal = AbortSignal.timeout(5000);

    await GeminiProvider.generate({ model: "m", prompt: "p", signal });

    expect(geminiGenerate.mock.calls[0][0].config.abortSignal).toBe(signal);
  });

  it("passes the signal to OpenAI as a RequestOptions signal", async () => {
    openaiCreate.mockResolvedValue({ output_text: "ok", usage: undefined });
    const { OpenAIProvider } = await import("../providers/openai");
    const signal = AbortSignal.timeout(5000);

    await OpenAIProvider.generate({ model: "m", prompt: "p", signal });

    // Second argument is RequestOptions, not part of the request body.
    expect(openaiCreate.mock.calls[0][1]).toEqual({ signal });
  });

  it("works when no signal is supplied", async () => {
    geminiGenerate.mockResolvedValue({ text: "ok", usageMetadata: undefined });
    const { GeminiProvider } = await import("../providers/gemini");
    await expect(GeminiProvider.generate({ model: "m", prompt: "p" })).resolves.toMatchObject({ content: "ok" });
    expect(geminiGenerate.mock.calls[0][0].config.abortSignal).toBeUndefined();
  });
});
