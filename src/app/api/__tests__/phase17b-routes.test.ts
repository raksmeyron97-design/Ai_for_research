import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Phase 17B §34: every new route must establish who is asking and which
 * project they own *before* it touches anything, and an object id in the body
 * must never be sufficient on its own.
 *
 * These assert the preamble, not the feature: an id from another project has
 * to read as "not found", and a route that skipped the project check would
 * pass its own feature tests perfectly while being the hole.
 */
const authMock = vi.hoisted(() => ({ requireUserId: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => authMock);

// Partially mocked: `project-schema.ts` reads SECTION_CHAIN from this module
// at import time, so replacing it wholesale breaks every route's section-type
// validation before a single test runs.
const dbProjects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("@/lib/db/projects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/projects")>()),
  ...dbProjects,
}));

const rateLimit = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  RATE_LIMITS: { aiRequest: { bucket: "ai_request", maxEvents: 60, windowSeconds: 600 } },
  rateLimitResponseBody: () => ({ error: "rate limited" }),
}));
vi.mock("@/lib/security/rate-limit", () => rateLimit);

const reviewService = vi.hoisted(() => ({ buildSectionReview: vi.fn() }));
vi.mock("@/lib/evidence/section-review-service", () => reviewService);

const versionsDb = vi.hoisted(() => ({ listSectionVersions: vi.fn(), restoreSectionVersion: vi.fn() }));
vi.mock("@/lib/db/section-versions", () => versionsDb);

const sectionsDb = vi.hoisted(() => ({ getSection: vi.fn(), upsertSection: vi.fn() }));
vi.mock("@/lib/db/sections", () => sectionsDb);

const evidenceDb = vi.hoisted(() => ({
  createClaims: vi.fn(),
  listClaims: vi.fn(),
  getClaim: vi.fn(),
  updateClaim: vi.fn(),
  deleteClaim: vi.fn(),
}));
vi.mock("@/lib/db/evidence", () => evidenceDb);

const insertion = vi.hoisted(() => ({
  insertEvidence: vi.fn(),
  EvidenceInsertionError: class extends Error {
    constructor(
      message: string,
      public readonly userMessage: string,
      public readonly status = 400,
    ) {
      super(message);
    }
  },
}));
vi.mock("@/lib/evidence/insertion", () => insertion);

const gapsDb = vi.hoisted(() => ({ listGaps: vi.fn(), createGaps: vi.fn() }));
vi.mock("@/lib/db/gaps", () => gapsDb);

const reviewRoute = await import("../research/projects/[projectId]/sections/[sectionType]/review/route");
const versionsRoute = await import("../research/projects/[projectId]/sections/[sectionType]/versions/route");
const claimsRoute = await import("../research/projects/[projectId]/claims/route");
const claimRoute = await import("../research/projects/[projectId]/claims/[claimId]/route");
const insertRoute = await import("../research/projects/[projectId]/evidence/insert/route");
const gapsRoute = await import("../research/projects/[projectId]/gaps/route");

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const CLAIM_ID = "22222222-2222-2222-2222-222222222222";
const CITATION_ID = "33333333-3333-3333-3333-333333333333";
const VERSION_ID = "44444444-4444-4444-4444-444444444444";

const params = Promise.resolve({ projectId: PROJECT_ID, sectionType: "research_problem" });
const claimParams = Promise.resolve({ projectId: PROJECT_ID, claimId: CLAIM_ID });
const projectParams = Promise.resolve({ projectId: PROJECT_ID });

function req(method: string, body?: unknown) {
  return new Request("http://localhost/x", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireUserId.mockResolvedValue("user-1");
  authMock.createClient.mockResolvedValue({});
  dbProjects.getProject.mockResolvedValue({ id: PROJECT_ID, user_id: "user-1", title: "T" });
  rateLimit.checkRateLimit.mockResolvedValue({ allowed: true });
  reviewService.buildSectionReview.mockResolvedValue({ sectionId: "s1" });
  versionsDb.listSectionVersions.mockResolvedValue([]);
  sectionsDb.getSection.mockResolvedValue({ id: "s1", content: "text", status: "in_progress", metadata: {} });
  evidenceDb.listClaims.mockResolvedValue([]);
  evidenceDb.createClaims.mockResolvedValue([]);
  evidenceDb.getClaim.mockResolvedValue({ id: CLAIM_ID, section_type: "research_problem" });
  gapsDb.listGaps.mockResolvedValue([]);
  gapsDb.createGaps.mockResolvedValue([]);
});

describe("every new route refuses an unauthenticated or foreign caller", () => {
  const cases: [string, () => Promise<Response>][] = [
    ["GET review", () => reviewRoute.GET(req("GET"), { params })],
    ["GET versions", () => versionsRoute.GET(req("GET"), { params })],
    ["POST restore", () => versionsRoute.POST(req("POST", { versionId: VERSION_ID }), { params })],
    ["GET claims", () => claimsRoute.GET(req("GET"), { params: projectParams })],
    [
      "POST claims",
      () =>
        claimsRoute.POST(
          req("POST", { sectionType: "research_problem", claims: [{ text: "A claim." }] }),
          { params: projectParams },
        ),
    ],
    ["PATCH claim", () => claimRoute.PATCH(req("PATCH", { text: "New." }), { params: claimParams })],
    ["DELETE claim", () => claimRoute.DELETE(req("DELETE"), { params: claimParams })],
    ["GET gaps", () => gapsRoute.GET(req("GET"), { params: projectParams })],
  ];

  it.each(cases)("%s answers 401 with no session", async (_name, call) => {
    authMock.requireUserId.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it.each(cases)("%s answers 404 for someone else's project", async (_name, call) => {
    dbProjects.getProject.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
  });
});

describe("section review", () => {
  it("rejects an unknown section type before doing any work", async () => {
    const res = await reviewRoute.GET(req("GET"), {
      params: Promise.resolve({ projectId: PROJECT_ID, sectionType: "not_a_section" }),
    });
    expect(res.status).toBe(400);
    expect(reviewService.buildSectionReview).not.toHaveBeenCalled();
  });

  it("returns the normalized review", async () => {
    const res = await reviewRoute.GET(req("GET"), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).review).toEqual({ sectionId: "s1" });
  });
});

describe("version restore", () => {
  it("answers with an empty history for a section that was never saved", async () => {
    sectionsDb.getSection.mockResolvedValue(null);
    const res = await versionsRoute.GET(req("GET"), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).versions).toEqual([]);
  });

  it("passes the current content through, so the new version records what it replaced", async () => {
    versionsDb.restoreSectionVersion.mockResolvedValue({
      section: { content: "restored" },
      version: { id: "v9", action: "restore" },
    });

    const res = await versionsRoute.POST(req("POST", { versionId: VERSION_ID }), { params });
    expect(res.status).toBe(200);
    expect(versionsDb.restoreSectionVersion).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ projectId: PROJECT_ID, versionId: VERSION_ID, currentContent: "text" }),
    );
  });

  it("rejects a body with no version id", async () => {
    expect((await versionsRoute.POST(req("POST", {}), { params })).status).toBe(400);
  });
});

describe("claims", () => {
  it("never lets a client set a claim's evidence status", async () => {
    await claimsRoute.POST(
      req("POST", {
        sectionType: "research_problem",
        claims: [{ text: "A claim.", type: "factual" }],
      }),
      { params: projectParams },
    );

    const [, rows] = evidenceDb.createClaims.mock.calls[0];
    expect(rows[0]).not.toHaveProperty("evidence_status");
    expect(rows[0]).not.toHaveProperty("needs_evidence");
  });

  it("re-resolves the claim inside the project before editing it", async () => {
    evidenceDb.getClaim.mockResolvedValue(null);
    const res = await claimRoute.PATCH(req("PATCH", { text: "New." }), { params: claimParams });
    expect(res.status).toBe(404);
    expect(evidenceDb.updateClaim).not.toHaveBeenCalled();
  });
});

describe("evidence insertion", () => {
  const body = {
    sectionType: "research_problem",
    claimId: CLAIM_ID,
    citationId: CITATION_ID,
    mode: "evidence_citation",
    excerpt: "An excerpt.",
    support: "SUPPORTED",
  };

  it("requires an explicit support judgement", async () => {
    const { support, ...withoutSupport } = body;
    void support;
    const res = await insertRoute.POST(req("POST", withoutSupport), { params: projectParams });
    expect(res.status).toBe(400);
    expect(insertion.insertEvidence).not.toHaveBeenCalled();
  });

  it("surfaces the service's own message and status for a rejected insertion", async () => {
    insertion.insertEvidence.mockRejectedValue(
      new insertion.EvidenceInsertionError("citation not in project", "That source is not in this project.", 404),
    );
    const res = await insertRoute.POST(req("POST", body), { params: projectParams });
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("That source is not in this project.");
  });

  it("never echoes a raw database error to the researcher", async () => {
    insertion.insertEvidence.mockRejectedValue(new Error('duplicate key value violates unique constraint "x_pkey"'));
    const res = await insertRoute.POST(req("POST", body), { params: projectParams });
    expect(res.status).toBe(500);
    expect((await res.json()).error).not.toMatch(/constraint/);
  });
});

describe("gaps", () => {
  it("refuses a gap attributed to no source but claiming a source stated it", async () => {
    const res = await gapsRoute.POST(
      req("POST", { gaps: [{ text: "A gap.", basis: "source_stated" }] }),
      { params: projectParams },
    );
    expect(res.status).toBe(400);
    expect(gapsDb.createGaps).not.toHaveBeenCalled();
  });

  it("never accepts `verified` from the client", async () => {
    await gapsRoute.POST(
      req("POST", { gaps: [{ text: "A gap.", basis: "ai_inference", verified: true }] }),
      { params: projectParams },
    );
    const [, rows] = gapsDb.createGaps.mock.calls[0];
    expect(rows[0].verified).toBe(false);
  });
});
