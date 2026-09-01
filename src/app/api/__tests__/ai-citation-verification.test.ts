import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 16 finding F3: `/api/ai/chat` and `/api/ai/generate` returned model
 * output with no citation check, while `quality-check.ts` and
 * `discussion-generator.ts` both ran one. Chat is the highest-traffic AI
 * surface, so it was the most likely path for an invented citation key to
 * reach a thesis.
 */
const authMock = vi.hoisted(() => ({ requireUserId: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => authMock);

const dbProjects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("@/lib/db/projects", () => dbProjects);

const dbConversations = vi.hoisted(() => ({
  createConversation: vi.fn(),
  getConversation: vi.fn(),
  insertMessage: vi.fn(),
}));
vi.mock("@/lib/db", () => dbConversations);

const rateLimit = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  RATE_LIMITS: { aiRequest: { limit: 10, windowSeconds: 60, bucket: "ai" } },
  rateLimitResponseBody: vi.fn(() => ({ error: "rate limited" })),
}));
vi.mock("@/lib/security/rate-limit", () => rateLimit);

const prepare = vi.hoisted(() => ({ resolveRequestContext: vi.fn() }));
vi.mock("@/lib/ai/prepare-request", () => prepare);

const integrityGuard = vi.hoisted(() => ({
  requiresDataset: vi.fn(() => false),
  verifyCitationsInText: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@/lib/ai/integrity-guard", () => integrityGuard);

const orchestratorMock = vi.hoisted(() => ({
  generate: vi.fn(),
  stream: vi.fn(),
}));
vi.mock("@/lib/ai/orchestrator", () => ({
  AIOrchestrator: class {
    generate = orchestratorMock.generate;
    stream = orchestratorMock.stream;
  },
}));

const { POST: chatPost } = await import("../ai/chat/route");
const { POST: generatePost } = await import("../ai/generate/route");

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";

function request(body: Record<string, unknown>) {
  return new Request("http://localhost/api/ai/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId: PROJECT_ID, taskType: "chat", message: "hi", ...body }),
  });
}

async function drain(res: Response): Promise<string> {
  return await res.text();
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireUserId.mockResolvedValue("user-1");
  authMock.createClient.mockResolvedValue({});
  dbProjects.getProject.mockResolvedValue({ id: PROJECT_ID, user_id: "user-1" });
  dbConversations.getConversation.mockResolvedValue(null);
  dbConversations.createConversation.mockResolvedValue({ id: "conv-1" });
  dbConversations.insertMessage.mockResolvedValue({});
  rateLimit.checkRateLimit.mockResolvedValue({ allowed: true });
  prepare.resolveRequestContext.mockImplementation(async (_s: unknown, r: Record<string, unknown>) => r);
  integrityGuard.requiresDataset.mockReturnValue(false);
  integrityGuard.verifyCitationsInText.mockResolvedValue([]);
  orchestratorMock.stream.mockImplementation(async function* () {
    yield { delta: "Prevalence was 21.4% [invented2020key].", done: false };
    yield { delta: "", done: true };
  });
  orchestratorMock.generate.mockResolvedValue({
    content: "Prevalence was 21.4% [invented2020key].",
    provider: "gemini",
    model: "m",
  });
});

describe("/api/ai/chat verifies citations (F3)", () => {
  it("checks the streamed answer against the project's saved sources", async () => {
    await drain(await chatPost(request({})));

    expect(integrityGuard.verifyCitationsInText).toHaveBeenCalledWith(
      expect.anything(),
      PROJECT_ID,
      "Prevalence was 21.4% [invented2020key].",
    );
  });

  it("surfaces an unresolvable citation key to the reader", async () => {
    integrityGuard.verifyCitationsInText.mockResolvedValueOnce([
      { severity: "high", category: "citation", message: 'Citation "invented2020key" was referenced but does not match any saved source for this project.' },
    ]);

    const text = await drain(await chatPost(request({})));

    expect(text).toContain("Citation check:");
    expect(text).toContain("invented2020key");
    // The answer the researcher already read is still delivered intact.
    expect(text).toContain("Prevalence was 21.4%");
  });

  it("stays silent when every citation resolves", async () => {
    const text = await drain(await chatPost(request({})));
    expect(text).not.toContain("Citation check:");
  });

  it("does not fail a delivered answer when the check itself throws", async () => {
    integrityGuard.verifyCitationsInText.mockRejectedValueOnce(new Error("db down"));
    const res = await chatPost(request({}));
    const text = await drain(res);

    expect(res.status).toBe(200);
    expect(text).toContain("Prevalence was 21.4%");
    expect(text).not.toContain("Citation check:");
  });

  it("skips the check when the model produced nothing", async () => {
    orchestratorMock.stream.mockImplementationOnce(async function* () {
      yield { delta: "", done: true };
    });
    await drain(await chatPost(request({})));
    expect(integrityGuard.verifyCitationsInText).not.toHaveBeenCalled();
  });
});

describe("/api/ai/generate verifies citations (F3)", () => {
  it("attaches citation warnings to the structured response", async () => {
    integrityGuard.verifyCitationsInText.mockResolvedValueOnce([
      { severity: "high", category: "citation", message: 'Citation "invented2020key" was referenced but does not match any saved source for this project.' },
    ]);

    const res = await generatePost(request({}));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.warnings).toHaveLength(1);
    expect(body.warnings[0].category).toBe("citation");
  });

  it("preserves warnings the orchestrator already produced", async () => {
    orchestratorMock.generate.mockResolvedValueOnce({
      content: "text [invented2020key]",
      provider: "gemini",
      model: "m",
      warnings: [{ severity: "high", category: "security", message: "injection suspected" }],
    });
    integrityGuard.verifyCitationsInText.mockResolvedValueOnce([
      { severity: "high", category: "citation", message: "unresolvable key" },
    ]);

    const body = await (await generatePost(request({}))).json();

    expect(body.warnings.map((w: { category: string }) => w.category)).toEqual(["security", "citation"]);
  });

  it("returns the response unchanged when nothing is flagged", async () => {
    const body = await (await generatePost(request({}))).json();
    expect(body.warnings).toBeUndefined();
  });

  it("does not fail the request when the check throws", async () => {
    integrityGuard.verifyCitationsInText.mockRejectedValueOnce(new Error("db down"));
    const res = await generatePost(request({}));
    expect(res.status).toBe(200);
  });
});
