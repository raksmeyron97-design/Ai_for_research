import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §31: every research-integrity route establishes who is asking and which
 * project they own before it touches anything, and no id in a body or a path
 * is authorisation on its own — mirrors phase18-routes.test.ts's own
 * discipline for the same reason.
 */
const authMock = vi.hoisted(() => ({ requireUserId: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => authMock);

// Partially mocked: project-schema.ts reads SECTION_CHAIN from this module at
// import time, so replacing it wholesale breaks section validation.
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

const citationsDb = vi.hoisted(() => ({ listCitations: vi.fn() }));
vi.mock("@/lib/db/citations", () => citationsDb);

const evidenceDb = vi.hoisted(() => ({ getClaim: vi.fn() }));
vi.mock("@/lib/db/evidence", () => evidenceDb);

const integrityDb = vi.hoisted(() => ({
  linkClaimToMethodology: vi.fn(),
  listClaimMethodologyLinks: vi.fn(),
  unlinkClaimMethodology: vi.fn(),
  upsertIntegrityDecision: vi.fn(),
  recordIntegrityEvent: vi.fn(),
}));
vi.mock("@/lib/db/integrity", () => integrityDb);

const reviewService = vi.hoisted(() => ({ buildResearchIntegrityReview: vi.fn() }));
vi.mock("@/lib/integrity/review-service", () => reviewService);

const referenceAudit = vi.hoisted(() => ({ findDuplicateReferences: vi.fn() }));
vi.mock("@/lib/integrity/reference-audit", () => referenceAudit);

const referenceMerge = vi.hoisted(() => ({
  mergeCitations: vi.fn(),
  ReferenceMergeError: class extends Error {},
}));
vi.mock("@/lib/integrity/reference-merge", () => referenceMerge);

const B = "../research/projects/[projectId]/integrity";
const reviewRoute = await import(`${B}/review/route`);
const gateRoute = await import(`${B}/gate/route`);
const decisionsRoute = await import(`${B}/decisions/route`);
const linksRoute = await import(`${B}/claims/[claimId]/methodology-links/route`);
const duplicatesRoute = await import(`${B}/references/duplicates/route`);
const mergeRoute = await import(`${B}/references/merge/route`);

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const CLAIM_ID = "22222222-2222-2222-2222-222222222222";
const CONSTRUCT_ID = "33333333-3333-3333-3333-333333333333";
const PRIMARY_ID = "44444444-4444-4444-4444-444444444444";
const DUPLICATE_ID = "55555555-5555-5555-5555-555555555555";

const projectParams = Promise.resolve({ projectId: PROJECT_ID });
const claimParams = Promise.resolve({ projectId: PROJECT_ID, claimId: CLAIM_ID });

function req(method: string, body?: unknown, url = "http://localhost/x") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireUserId.mockResolvedValue("user-1");
  authMock.createClient.mockResolvedValue({});
  dbProjects.getProject.mockResolvedValue({ id: PROJECT_ID, user_id: "user-1", title: "T", language: "en" });
  rateLimit.checkRateLimit.mockResolvedValue({ allowed: true });

  citationsDb.listCitations.mockResolvedValue([]);
  evidenceDb.getClaim.mockResolvedValue({ id: CLAIM_ID, project_id: PROJECT_ID, claim_text: "X", claim_type: "factual" });
  integrityDb.linkClaimToMethodology.mockResolvedValue({ id: "link-1" });
  integrityDb.listClaimMethodologyLinks.mockResolvedValue([]);
  integrityDb.unlinkClaimMethodology.mockResolvedValue(undefined);
  integrityDb.upsertIntegrityDecision.mockResolvedValue({ id: "d1", finding_id: "citation:missing:x", status: "dismissed" });
  integrityDb.recordIntegrityEvent.mockResolvedValue({ id: "e1" });
  reviewService.buildResearchIntegrityReview.mockResolvedValue({
    projectId: PROJECT_ID,
    metrics: [],
    findings: [],
    coverage: { citation: { requiringEvidence: 0, cited: 0, linkedToEvidence: 0, linkedToResolvableSource: 0 }, evidence: { coverage: null } },
    decisions: {},
    generatedAt: "",
  });
  referenceAudit.findDuplicateReferences.mockReturnValue([]);
  referenceMerge.mergeCitations.mockResolvedValue({ id: PRIMARY_ID, citation_key: "a" });
});

describe("every research-integrity route refuses an unauthenticated or foreign caller", () => {
  const cases: [string, () => Promise<Response>][] = [
    ["GET review", () => reviewRoute.GET(req("GET"), { params: projectParams })],
    ["GET gate", () => gateRoute.GET(req("GET"), { params: projectParams })],
    [
      "POST decisions",
      () => decisionsRoute.POST(req("POST", { findingId: "citation:missing:x", status: "dismissed" }), { params: projectParams }),
    ],
    ["GET methodology-links", () => linksRoute.GET(req("GET"), { params: claimParams })],
    [
      "POST methodology-links",
      () => linksRoute.POST(req("POST", { constructId: CONSTRUCT_ID }), { params: claimParams }),
    ],
    ["DELETE methodology-links", () => linksRoute.DELETE(req("DELETE", undefined, "http://localhost/x?linkId=link-1"), { params: claimParams })],
    ["GET duplicates", () => duplicatesRoute.GET(req("GET"), { params: projectParams })],
    [
      "POST merge",
      () => mergeRoute.POST(req("POST", { primaryId: PRIMARY_ID, duplicateId: DUPLICATE_ID }), { params: projectParams }),
    ],
  ];

  it.each(cases)("%s -> 401 when unauthenticated", async (_name, run) => {
    authMock.requireUserId.mockResolvedValue(null);
    const res = await run();
    expect(res.status).toBe(401);
  });

  it.each(cases)("%s -> 404 when the project belongs to someone else", async (_name, run) => {
    dbProjects.getProject.mockResolvedValue(null);
    const res = await run();
    expect(res.status).toBe(404);
  });
});

describe("input validation", () => {
  it("rejects a decision with an unknown status", async () => {
    const res = await decisionsRoute.POST(
      req("POST", { findingId: "citation:missing:x", status: "not-a-real-status" }),
      { params: projectParams },
    );
    expect(res.status).toBe(400);
  });

  it("rejects a methodology-link body naming zero targets", async () => {
    const res = await linksRoute.POST(req("POST", {}), { params: claimParams });
    expect(res.status).toBe(400);
  });

  it("rejects a methodology-link body naming two targets", async () => {
    const res = await linksRoute.POST(
      req("POST", { constructId: CONSTRUCT_ID, hypothesisId: "66666666-6666-6666-6666-666666666666" }),
      { params: claimParams },
    );
    expect(res.status).toBe(400);
  });

  it("rejects a merge request missing a duplicateId", async () => {
    const res = await mergeRoute.POST(req("POST", { primaryId: PRIMARY_ID }), { params: projectParams });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid ?section= on the review route", async () => {
    const res = await reviewRoute.GET(req("GET", undefined, "http://localhost/x?section=not-a-real-section"), {
      params: projectParams,
    });
    expect(res.status).toBe(400);
  });
});

describe("ids in a path are re-resolved inside the project (§27)", () => {
  it("refuses to link a claim that belongs to another project", async () => {
    evidenceDb.getClaim.mockResolvedValue(null);
    const res = await linksRoute.POST(req("POST", { constructId: CONSTRUCT_ID }), { params: claimParams });
    expect(res.status).toBe(404);
  });
});

describe("the export gate never blocks by default (§29)", () => {
  it("always returns blocking: false", async () => {
    const res = await gateRoute.GET(req("GET"), { params: projectParams });
    const body = await res.json();
    expect(body.blocking).toBe(false);
  });
});

describe("reference merge surfaces a clear error rather than a generic 500", () => {
  it("maps ReferenceMergeError to a 400 with its message", async () => {
    referenceMerge.mergeCitations.mockRejectedValue(new referenceMerge.ReferenceMergeError("Both references must belong to this project."));
    const res = await mergeRoute.POST(req("POST", { primaryId: PRIMARY_ID, duplicateId: DUPLICATE_ID }), {
      params: projectParams,
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/belong to this project/);
  });
});
