import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const authMock = vi.hoisted(() => ({
  requireUserId: vi.fn(),
  createClient: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => authMock);

const dbProjects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("@/lib/db/projects", () => dbProjects);

const dbInstruments = vi.hoisted(() => ({ listInstruments: vi.fn() }));
vi.mock("@/lib/db/instruments", () => dbInstruments);

const generatorMock = vi.hoisted(() => ({ generateQuestionnaire: vi.fn() }));
vi.mock("@/lib/ai/questionnaire-generator", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ai/questionnaire-generator")>(
    "@/lib/ai/questionnaire-generator",
  );
  return { ...actual, generateQuestionnaire: generatorMock.generateQuestionnaire };
});

const { POST } = await import("../research/projects/[projectId]/instruments/route");
const { QuestionnaireGenerationError } = await import("@/lib/ai/questionnaire-generator");
const { AllProvidersFailedError } = await import("@/lib/ai/errors");
const { AIProviderError } = await import("@/lib/ai/errors");

/** A minimal real-shaped fake of the rate_limit_events / idempotency_keys tables, so the route exercises the real rate-limit.ts / idempotency.ts logic instead of mocking it away. */
function createFakeSupabase(options: {
  rateLimitCount?: number;
  idempotencyHit?: { status_code: number; response_body: unknown } | null;
} = {}): { client: SupabaseClient; idempotencyInserts: unknown[] } {
  const idempotencyInserts: unknown[] = [];
  const from = vi.fn((table: string) => {
    if (table === "rate_limit_events") {
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
        insert() {
          return Promise.resolve({ error: null });
        },
        then(onFulfilled: (v: unknown) => unknown) {
          return Promise.resolve({ count: options.rateLimitCount ?? 0, error: null }).then(onFulfilled);
        },
      };
      return builder;
    }
    if (table === "idempotency_keys") {
      const builder = {
        select() {
          return builder;
        },
        eq() {
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: options.idempotencyHit ?? null, error: null });
        },
        insert(payload: unknown) {
          idempotencyInserts.push(payload);
          return Promise.resolve({ error: null });
        },
      };
      return builder;
    }
    throw new Error(`unexpected table in test fake: ${table}`);
  });
  return { client: { from } as unknown as SupabaseClient, idempotencyInserts };
}

function makeRequest(body?: Record<string, string>) {
  return new Request("http://localhost/api/research/projects/proj-1/instruments", {
    method: "POST",
    headers: body?.idempotencyKey ? { "Idempotency-Key": body.idempotencyKey } : {},
  });
}

const params = Promise.resolve({ projectId: "proj-1" });

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/research/projects/[projectId]/instruments — security", () => {
  it("returns 401 when there is no authenticated user", async () => {
    authMock.requireUserId.mockResolvedValue(null);
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(401);
    expect(dbProjects.getProject).not.toHaveBeenCalled();
  });

  it("returns 503 rather than crashing when the auth service itself throws", async () => {
    authMock.requireUserId.mockRejectedValue(new Error("auth service down"));
    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(503);
  });

  it("returns 404 (not the other user's project) when getProject returns null — RLS-denied or nonexistent look identical", async () => {
    authMock.requireUserId.mockResolvedValue("user-1");
    authMock.createClient.mockResolvedValue(createFakeSupabase().client);
    dbProjects.getProject.mockResolvedValue(null);

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(404);
    expect(generatorMock.generateQuestionnaire).not.toHaveBeenCalled();
  });

  it("returns 429 and never calls the generator once the rate limit is exhausted", async () => {
    authMock.requireUserId.mockResolvedValue("user-1");
    authMock.createClient.mockResolvedValue(createFakeSupabase({ rateLimitCount: 999 }).client);
    dbProjects.getProject.mockResolvedValue({ id: "proj-1" });

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(429);
    expect(generatorMock.generateQuestionnaire).not.toHaveBeenCalled();
  });

  it("maps QuestionnaireGenerationError to a 422, not a raw 500", async () => {
    authMock.requireUserId.mockResolvedValue("user-1");
    authMock.createClient.mockResolvedValue(createFakeSupabase().client);
    dbProjects.getProject.mockResolvedValue({ id: "proj-1" });
    generatorMock.generateQuestionnaire.mockRejectedValue(new QuestionnaireGenerationError("no objectives yet"));

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(422);
  });

  it("maps AllProvidersFailedError to a 503 with a clean message, never a raw provider error", async () => {
    authMock.requireUserId.mockResolvedValue("user-1");
    authMock.createClient.mockResolvedValue(createFakeSupabase().client);
    dbProjects.getProject.mockResolvedValue({ id: "proj-1" });
    generatorMock.generateQuestionnaire.mockRejectedValue(
      new AllProvidersFailedError([new AIProviderError("gemini", "secret internal detail", true)]),
    );

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).not.toContain("secret internal detail");
  });

  it("replays a cached response instead of calling the generator again when the same Idempotency-Key was already used successfully", async () => {
    authMock.requireUserId.mockResolvedValue("user-1");
    authMock.createClient.mockResolvedValue(
      createFakeSupabase({ idempotencyHit: { status_code: 201, response_body: { instrument: { id: "cached" } } } }).client,
    );
    dbProjects.getProject.mockResolvedValue({ id: "proj-1" });

    const res = await POST(makeRequest({ idempotencyKey: "dup-key" }), { params });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.instrument.id).toBe("cached");
    expect(generatorMock.generateQuestionnaire).not.toHaveBeenCalled();
  });

  it("calls the generator normally and records the result when a fresh Idempotency-Key is used", async () => {
    authMock.requireUserId.mockResolvedValue("user-1");
    const { client, idempotencyInserts } = createFakeSupabase({ idempotencyHit: null });
    authMock.createClient.mockResolvedValue(client);
    dbProjects.getProject.mockResolvedValue({ id: "proj-1" });
    generatorMock.generateQuestionnaire.mockResolvedValue({ instrument: { id: "new-1" }, questions: [] });

    const res = await POST(makeRequest({ idempotencyKey: "fresh-key" }), { params });
    expect(res.status).toBe(201);
    expect(generatorMock.generateQuestionnaire).toHaveBeenCalledTimes(1);
    expect(idempotencyInserts).toHaveLength(1);
  });

  it("does not check or record idempotency at all when the client sends no Idempotency-Key — opt-in, no behavior change for existing callers", async () => {
    authMock.requireUserId.mockResolvedValue("user-1");
    const { client, idempotencyInserts } = createFakeSupabase();
    authMock.createClient.mockResolvedValue(client);
    dbProjects.getProject.mockResolvedValue({ id: "proj-1" });
    generatorMock.generateQuestionnaire.mockResolvedValue({ instrument: { id: "new-1" }, questions: [] });

    const res = await POST(makeRequest(), { params });
    expect(res.status).toBe(201);
    expect(idempotencyInserts).toHaveLength(0);
  });
});
