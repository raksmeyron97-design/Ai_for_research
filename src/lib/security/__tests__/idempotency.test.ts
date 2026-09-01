import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCachedIdempotentResponse, getIdempotencyKey, saveIdempotentResponse } from "../idempotency";

function createMock(options: {
  lookupData?: { status_code: number; response_body: unknown } | null;
  lookupError?: string;
  insertError?: { code: string; message: string };
}) {
  const insertCalls: unknown[] = [];
  const from = vi.fn(() => {
    const builder = {
      select() {
        return builder;
      },
      eq() {
        return builder;
      },
      maybeSingle() {
        return Promise.resolve(
          options.lookupError
            ? { data: null, error: { message: options.lookupError } }
            : { data: options.lookupData ?? null, error: null },
        );
      },
      insert(payload: unknown) {
        insertCalls.push(payload);
        return Promise.resolve({ error: options.insertError ?? null });
      },
    };
    return builder;
  });
  return { client: { from } as unknown as SupabaseClient, insertCalls };
}

describe("getIdempotencyKey", () => {
  it("reads the Idempotency-Key header", () => {
    const req = new Request("http://x", { headers: { "Idempotency-Key": "abc-123" } });
    expect(getIdempotencyKey(req)).toBe("abc-123");
  });

  it("returns null when the header is absent — idempotency is opt-in", () => {
    const req = new Request("http://x");
    expect(getIdempotencyKey(req)).toBeNull();
  });
});

describe("getCachedIdempotentResponse", () => {
  it("returns the cached response on a hit", async () => {
    const { client } = createMock({ lookupData: { status_code: 201, response_body: { ok: true } } });
    const result = await getCachedIdempotentResponse(client, "u1", "questionnaire_generate", "key-1");
    expect(result).toEqual({ status: 201, body: { ok: true } });
  });

  it("returns null on a miss", async () => {
    const { client } = createMock({ lookupData: null });
    const result = await getCachedIdempotentResponse(client, "u1", "questionnaire_generate", "key-1");
    expect(result).toBeNull();
  });

  it("fails open (returns null) when the lookup itself errors", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createMock({ lookupError: "connection refused" });
    const result = await getCachedIdempotentResponse(client, "u1", "questionnaire_generate", "key-1");
    expect(result).toBeNull();
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("idempotency_lookup_failed"));
    spy.mockRestore();
  });
});

describe("saveIdempotentResponse", () => {
  it("saves a successful (2xx) response", async () => {
    const { client, insertCalls } = createMock({});
    await saveIdempotentResponse(client, "u1", "questionnaire_generate", "key-1", 201, { ok: true });
    expect(insertCalls).toHaveLength(1);
    expect(insertCalls[0]).toMatchObject({ user_id: "u1", route: "questionnaire_generate", key: "key-1", status_code: 201 });
  });

  it("never caches a failed response — a retry after a real failure must be free to actually retry", async () => {
    const { client, insertCalls } = createMock({});
    await saveIdempotentResponse(client, "u1", "questionnaire_generate", "key-1", 503, { error: "unavailable" });
    expect(insertCalls).toHaveLength(0);
  });

  it("does not surface a unique-constraint violation as an error — a concurrent request won the race, which is fine", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createMock({ insertError: { code: "23505", message: "duplicate key" } });
    await saveIdempotentResponse(client, "u1", "questionnaire_generate", "key-1", 201, { ok: true });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("logs a real insert failure that is not a unique-constraint violation", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = createMock({ insertError: { code: "42501", message: "permission denied" } });
    await saveIdempotentResponse(client, "u1", "questionnaire_generate", "key-1", 201, { ok: true });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("idempotency_save_failed"));
    spy.mockRestore();
  });
});
