import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkRateLimit } from "../rate-limit";

function createMock(options: { count: number | null; countError?: string; insertError?: string }) {
  const insertCalls: unknown[] = [];
  const from = vi.fn(() => {
    const builder = {
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      gte() {
        return builder;
      },
      insert(payload: unknown) {
        insertCalls.push(payload);
        return Promise.resolve({
          error: options.insertError ? { message: options.insertError } : null,
        });
      },
      then(onFulfilled: (v: unknown) => unknown, onRejected: (e: unknown) => unknown) {
        const result = options.countError
          ? { count: null, error: { message: options.countError } }
          : { count: options.count, error: null };
        return Promise.resolve(result).then(onFulfilled, onRejected);
      },
    };
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, insertCalls };
}

const config = { bucket: "ai_request", maxEvents: 5, windowSeconds: 60 };

describe("checkRateLimit", () => {
  it("allows the request and records an event when under the limit", async () => {
    const { client, insertCalls } = createMock({ count: 2 });
    const result = await checkRateLimit(client, "user-1", config);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(2); // 5 - 2 - 1
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toEqual({ user_id: "user-1", bucket: "ai_request" });
  });

  it("blocks the request without recording a new event once the limit is reached", async () => {
    const { client, insertCalls } = createMock({ count: 5 });
    const result = await checkRateLimit(client, "user-1", config);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
    expect(result.retryAfterSeconds).toBe(60);
    expect(insertCalls).toHaveLength(0);
  });

  it("blocks once the count exceeds the limit, not only when exactly equal", async () => {
    const { client } = createMock({ count: 9 });
    const result = await checkRateLimit(client, "user-1", config);
    expect(result.allowed).toBe(false);
  });

  it("fails open (allows the request) when the count query itself errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createMock({ count: null, countError: "connection refused" });
    const result = await checkRateLimit(client, "user-1", config);
    expect(result.allowed).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("rate_limit_check_failed"));
    spy.mockRestore();
  });

  it("still allows the request even when recording the event fails", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createMock({ count: 0, insertError: "permission denied" });
    const result = await checkRateLimit(client, "user-1", config);
    expect(result.allowed).toBe(true);
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("rate_limit_record_failed"));
    spy.mockRestore();
  });
});
