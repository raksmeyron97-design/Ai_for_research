import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AIStreamIdleTimeoutError,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  getStreamIdleTimeoutMs,
  isStreamTimeout,
  withIdleTimeout,
} from "../stream-guard";
import type { AIChunk } from "../types";

/**
 * Phase 16A: `AIOrchestrator.stream()` bypassed withRetry entirely, so a
 * stalled provider stream left the request hanging with no bound at all.
 *
 * The guard is an IDLE-GAP timeout, not a total-duration budget: a long
 * answer that keeps producing tokens must never be killed, while a
 * connection that goes quiet must be.
 */
function controller() {
  return new AbortController();
}

async function collect(iterable: AsyncIterable<AIChunk>): Promise<AIChunk[]> {
  const out: AIChunk[] = [];
  for await (const chunk of iterable) out.push(chunk);
  return out;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("configuration", () => {
  afterEach(() => {
    delete process.env.AI_STREAM_IDLE_TIMEOUT_MS;
  });

  it("uses a sensible default", () => {
    expect(getStreamIdleTimeoutMs()).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS);
  });

  it("honours AI_STREAM_IDLE_TIMEOUT_MS", () => {
    process.env.AI_STREAM_IDLE_TIMEOUT_MS = "1234";
    expect(getStreamIdleTimeoutMs()).toBe(1234);
  });

  it("ignores a nonsensical value rather than disabling the guard", () => {
    process.env.AI_STREAM_IDLE_TIMEOUT_MS = "not-a-number";
    expect(getStreamIdleTimeoutMs()).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS);
    process.env.AI_STREAM_IDLE_TIMEOUT_MS = "-5";
    expect(getStreamIdleTimeoutMs()).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS);
  });
});

describe("withIdleTimeout", () => {
  it("passes a normal stream through unchanged", async () => {
    async function* source() {
      yield { delta: "a", done: false };
      yield { delta: "b", done: false };
      yield { delta: "", done: true };
    }

    const chunks = await collect(withIdleTimeout(source(), { idleMs: 500, provider: "gemini", controller: controller() }));
    expect(chunks.map((c) => c.delta)).toEqual(["a", "b", ""]);
  });

  it("does NOT time out a slow but continuous stream that outlives the idle budget", async () => {
    // Six gaps of 30ms each = 180ms total, well past the 60ms idle budget,
    // but no single gap exceeds it. A total-duration timeout would kill this.
    async function* source() {
      for (let i = 0; i < 6; i += 1) {
        await sleep(30);
        yield { delta: `chunk${i}`, done: false };
      }
    }

    const chunks = await collect(withIdleTimeout(source(), { idleMs: 60, provider: "gemini", controller: controller() }));
    expect(chunks).toHaveLength(6);
  });

  it("aborts a stalled stream and reports how far it got", async () => {
    async function* source() {
      yield { delta: "partial", done: false };
      await sleep(10_000); // never arrives
      yield { delta: "never", done: false };
    }

    const ctrl = controller();
    const received: AIChunk[] = [];

    await expect(
      (async () => {
        for await (const chunk of withIdleTimeout(source(), { idleMs: 40, provider: "gemini", controller: ctrl })) {
          received.push(chunk);
        }
      })(),
    ).rejects.toBeInstanceOf(AIStreamIdleTimeoutError);

    expect(received.map((c) => c.delta)).toEqual(["partial"]);
    // The signal is what actually cancels the provider request.
    expect(ctrl.signal.aborted).toBe(true);
  });

  it("times out a stream that never yields a first chunk", async () => {
    async function* source(): AsyncGenerator<AIChunk> {
      await sleep(10_000);
      yield { delta: "never", done: false };
    }

    const ctrl = controller();
    await expect(
      collect(withIdleTimeout(source(), { idleMs: 40, provider: "openai", controller: ctrl })),
    ).rejects.toBeInstanceOf(AIStreamIdleTimeoutError);
    expect(ctrl.signal.aborted).toBe(true);
  });

  it("propagates a provider error rather than masking it as a timeout", async () => {
    async function* source(): AsyncGenerator<AIChunk> {
      yield { delta: "partial", done: false };
      throw new Error("connection reset");
    }

    await expect(
      collect(withIdleTimeout(source(), { idleMs: 500, provider: "gemini", controller: controller() })),
    ).rejects.toThrow("connection reset");
  });

  it("releases the upstream iterator when the consumer stops early", async () => {
    let returned = false;
    const source: AsyncIterable<AIChunk> = {
      [Symbol.asyncIterator]() {
        let i = 0;
        return {
          async next() {
            return { value: { delta: `c${i++}`, done: false }, done: false };
          },
          async return() {
            returned = true;
            return { value: undefined, done: true };
          },
        } as AsyncIterator<AIChunk>;
      },
    };

    for await (const _chunk of withIdleTimeout(source, { idleMs: 500, provider: "gemini", controller: controller() })) {
      break; // consumer walks away after one chunk
    }

    expect(returned).toBe(true);
  });

  it("leaves no timer pending after a clean finish", async () => {
    vi.useFakeTimers();
    try {
      async function* source() {
        yield { delta: "a", done: true };
      }
      await collect(withIdleTimeout(source(), { idleMs: 1000, provider: "gemini", controller: controller() }));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not duplicate chunks", async () => {
    async function* source() {
      yield { delta: "a", done: false };
      yield { delta: "a", done: false };
      yield { delta: "b", done: true };
    }
    const chunks = await collect(withIdleTimeout(source(), { idleMs: 500, provider: "gemini", controller: controller() }));
    // Two identical deltas in, two out — the guard neither drops nor repeats.
    expect(chunks.map((c) => c.delta)).toEqual(["a", "a", "b"]);
  });

  it("classifies its own error as a stream timeout", () => {
    expect(isStreamTimeout(new AIStreamIdleTimeoutError("gemini", 100, 2))).toBe(true);
    expect(isStreamTimeout(new Error("something else"))).toBe(false);
  });
});
