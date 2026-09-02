import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * §37: every Phase 20 route establishes who is asking and which project they
 * own before it touches anything, and no id in a body or a path is
 * authorisation on its own — the same discipline phase18-routes.test.ts and
 * phase19-routes.test.ts already hold their own routes to.
 */
const authMock = vi.hoisted(() => ({ requireUserId: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => authMock);

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

const frameworkDb = vi.hoisted(() => ({
  listFrameworkNodes: vi.fn(),
  getFrameworkNode: vi.fn(),
  createFrameworkNode: vi.fn(),
  updateFrameworkNode: vi.fn(),
  deleteFrameworkNode: vi.fn(),
  listFrameworkRelationships: vi.fn(),
  createFrameworkRelationship: vi.fn(),
  updateFrameworkRelationship: vi.fn(),
  deleteFrameworkRelationship: vi.fn(),
}));
vi.mock("@/lib/db/framework", () => frameworkDb);

const citationsDb = vi.hoisted(() => ({ searchCitations: vi.fn() }));
vi.mock("@/lib/db/citations", () => citationsDb);

const reviewService = vi.hoisted(() => ({ buildResearchSystemReview: vi.fn() }));
vi.mock("@/lib/review/review-service", () => reviewService);

const events = vi.hoisted(() => ({ recordMethodologyEvent: vi.fn() }));
vi.mock("@/lib/db/methodology-events", () => events);

const B = "../research/projects/[projectId]";
const nodesRoute = await import(`${B}/framework/nodes/route`);
const nodeRoute = await import(`${B}/framework/nodes/[nodeId]/route`);
const relsRoute = await import(`${B}/framework/relationships/route`);
const relRoute = await import(`${B}/framework/relationships/[relationshipId]/route`);
const searchRoute = await import(`${B}/sources/search/route`);
const systemReviewRoute = await import(`${B}/review/route`);

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const NODE_ID = "22222222-2222-2222-2222-222222222222";
const OTHER_NODE_ID = "33333333-3333-3333-3333-333333333333";
const CONSTRUCT_ID = "44444444-4444-4444-4444-444444444444";
const REL_ID = "55555555-5555-5555-5555-555555555555";
const HYPOTHESIS_ID = "66666666-6666-6666-6666-666666666666";

const projectParams = Promise.resolve({ projectId: PROJECT_ID });
const nodeParams = Promise.resolve({ projectId: PROJECT_ID, nodeId: NODE_ID });
const relParams = Promise.resolve({ projectId: PROJECT_ID, relationshipId: REL_ID });

function req(method: string, body?: unknown, url = "http://localhost/x") {
  return new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const NODE = {
  id: NODE_ID,
  project_id: PROJECT_ID,
  construct_id: CONSTRUCT_ID,
  label: null,
  position_x: 0,
  position_y: 0,
  provenance: "user",
  confirmed: true,
};

const REL = {
  id: REL_ID,
  project_id: PROJECT_ID,
  from_node_id: NODE_ID,
  to_node_id: OTHER_NODE_ID,
  relation_type: "predicts",
  hypothesis_id: null,
  rationale: null,
  provenance: "user",
  confirmed: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireUserId.mockResolvedValue("user-1");
  authMock.createClient.mockResolvedValue({});
  dbProjects.getProject.mockResolvedValue({ id: PROJECT_ID, user_id: "user-1", title: "T", language: "en" });
  rateLimit.checkRateLimit.mockResolvedValue({ allowed: true });
  events.recordMethodologyEvent.mockResolvedValue({ id: "e1" });

  frameworkDb.listFrameworkNodes.mockResolvedValue([]);
  frameworkDb.getFrameworkNode.mockResolvedValue(NODE);
  frameworkDb.createFrameworkNode.mockResolvedValue(NODE);
  frameworkDb.updateFrameworkNode.mockResolvedValue(NODE);
  frameworkDb.deleteFrameworkNode.mockResolvedValue(true);
  frameworkDb.listFrameworkRelationships.mockResolvedValue([]);
  frameworkDb.createFrameworkRelationship.mockResolvedValue(REL);
  frameworkDb.updateFrameworkRelationship.mockResolvedValue(REL);
  frameworkDb.deleteFrameworkRelationship.mockResolvedValue(true);

  citationsDb.searchCitations.mockResolvedValue({ rows: [], total: 0, limit: 25, offset: 0 });
  reviewService.buildResearchSystemReview.mockResolvedValue({
    projectId: PROJECT_ID,
    metrics: [],
    findings: [],
    generatedAt: "",
  });
});

describe("every Phase 20 route refuses an unauthenticated or foreign caller", () => {
  const cases: [string, () => Promise<Response>][] = [
    ["GET nodes", () => nodesRoute.GET(req("GET"), { params: projectParams })],
    ["POST nodes", () => nodesRoute.POST(req("POST", { constructId: CONSTRUCT_ID }), { params: projectParams })],
    ["PATCH node", () => nodeRoute.PATCH(req("PATCH", { positionX: 10 }), { params: nodeParams })],
    ["DELETE node", () => nodeRoute.DELETE(req("DELETE"), { params: nodeParams })],
    ["GET relationships", () => relsRoute.GET(req("GET"), { params: projectParams })],
    [
      "POST relationships",
      () =>
        relsRoute.POST(req("POST", { fromNodeId: NODE_ID, toNodeId: OTHER_NODE_ID }), {
          params: projectParams,
        }),
    ],
    ["PATCH relationship", () => relRoute.PATCH(req("PATCH", { relationType: "influences" }), { params: relParams })],
    ["DELETE relationship", () => relRoute.DELETE(req("DELETE"), { params: relParams })],
    ["GET source search", () => searchRoute.GET(req("GET"), { params: projectParams })],
    ["GET system review", () => systemReviewRoute.GET(req("GET"), { params: projectParams })],
  ];

  it.each(cases)("%s -> 401 when unauthenticated", async (_name, run) => {
    authMock.requireUserId.mockResolvedValue(null);
    expect((await run()).status).toBe(401);
  });

  it.each(cases)("%s -> 404 when the project belongs to someone else", async (_name, run) => {
    // 404 rather than 403: identical to a project that does not exist, so a
    // probe learns nothing about what other projects hold.
    dbProjects.getProject.mockResolvedValue(null);
    expect((await run()).status).toBe(404);
  });

  it.each(cases)("%s touches no data before authorising", async (_name, run) => {
    dbProjects.getProject.mockResolvedValue(null);
    await run();
    for (const fn of Object.values(frameworkDb)) expect(fn).not.toHaveBeenCalled();
    expect(citationsDb.searchCitations).not.toHaveBeenCalled();
    expect(reviewService.buildResearchSystemReview).not.toHaveBeenCalled();
  });
});

describe("framework nodes", () => {
  it("creates a node bound to a construct", async () => {
    const res = await nodesRoute.POST(req("POST", { constructId: CONSTRUCT_ID }), { params: projectParams });
    expect(res.status).toBe(201);
    expect(frameworkDb.createFrameworkNode).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ project_id: PROJECT_ID, construct_id: CONSTRUCT_ID }),
    );
  });

  it("creates an unmapped node from a label alone", async () => {
    const res = await nodesRoute.POST(req("POST", { label: "Motivation" }), { params: projectParams });
    expect(res.status).toBe(201);
    expect(frameworkDb.createFrameworkNode).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ construct_id: null, label: "Motivation" }),
    );
  });

  it("rejects a node with neither construct nor label", async () => {
    const res = await nodesRoute.POST(req("POST", {}), { params: projectParams });
    expect(res.status).toBe(400);
    expect(frameworkDb.createFrameworkNode).not.toHaveBeenCalled();
  });

  it("validates the body before authorising, and writes nothing on a bad one", async () => {
    const res = await nodesRoute.POST(req("POST", { constructId: "not-a-uuid" }), { params: projectParams });
    expect(res.status).toBe(400);
    expect(frameworkDb.createFrameworkNode).not.toHaveBeenCalled();
  });

  it("passes the project id from the path, never one from the body", async () => {
    await nodesRoute.POST(
      req("POST", { constructId: CONSTRUCT_ID, project_id: "99999999-9999-9999-9999-999999999999" }),
      { params: projectParams },
    );
    expect(frameworkDb.createFrameworkNode).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ project_id: PROJECT_ID }),
    );
  });

  it("scopes an update to the project as well as the node id", async () => {
    await nodeRoute.PATCH(req("PATCH", { positionX: 42 }), { params: nodeParams });
    expect(frameworkDb.updateFrameworkNode).toHaveBeenCalledWith({}, PROJECT_ID, NODE_ID, {
      position_x: 42,
    });
  });

  it("returns 404 when the patch matches no row in this project", async () => {
    // A node belonging to another project matches nothing under the caller's
    // RLS, and that must look identical to an id that does not exist.
    frameworkDb.updateFrameworkNode.mockResolvedValue(null);
    const res = await nodeRoute.PATCH(req("PATCH", { positionX: 1 }), { params: nodeParams });
    expect(res.status).toBe(404);
  });

  it("treats unlinking as an explicit null rather than an omitted field", async () => {
    await nodeRoute.PATCH(req("PATCH", { constructId: null }), { params: nodeParams });
    expect(frameworkDb.updateFrameworkNode).toHaveBeenCalledWith({}, PROJECT_ID, NODE_ID, {
      construct_id: null,
    });
  });

  it("rejects an empty patch", async () => {
    const res = await nodeRoute.PATCH(req("PATCH", {}), { params: nodeParams });
    expect(res.status).toBe(400);
  });

  it("records an audit entry when a node is created", async () => {
    await nodesRoute.POST(req("POST", { label: "Motivation" }), { params: projectParams });
    expect(events.recordMethodologyEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ entity_type: "framework_node", action: "created" }),
    );
  });

  it("records the deletion even though the row is gone", async () => {
    await nodeRoute.DELETE(req("DELETE"), { params: nodeParams });
    expect(events.recordMethodologyEvent).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ entity_type: "framework_node", action: "deleted", entity_id: NODE_ID }),
    );
  });
});

describe("framework relationships", () => {
  it("defaults to the non-directional relation type", async () => {
    // Overclaiming a direction the researcher did not state is worse than
    // saying only that two things are related.
    await relsRoute.POST(req("POST", { fromNodeId: NODE_ID, toNodeId: OTHER_NODE_ID }), {
      params: projectParams,
    });
    expect(frameworkDb.createFrameworkRelationship).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ relation_type: "associated_with" }),
    );
  });

  it("accepts each word in the vocabulary", async () => {
    for (const relationType of [
      "predicts",
      "influences",
      "mediates",
      "moderates",
      "associated_with",
      "supports",
    ]) {
      const res = await relsRoute.POST(
        req("POST", { fromNodeId: NODE_ID, toNodeId: OTHER_NODE_ID, relationType }),
        { params: projectParams },
      );
      expect(res.status).toBe(201);
    }
  });

  it("refuses a relation type outside the vocabulary", async () => {
    const res = await relsRoute.POST(
      req("POST", { fromNodeId: NODE_ID, toNodeId: OTHER_NODE_ID, relationType: "causes" }),
      { params: projectParams },
    );
    expect(res.status).toBe(400);
    expect(frameworkDb.createFrameworkRelationship).not.toHaveBeenCalled();
  });

  it("carries the hypothesis link on the relationship", async () => {
    await relsRoute.POST(
      req("POST", { fromNodeId: NODE_ID, toNodeId: OTHER_NODE_ID, hypothesisId: HYPOTHESIS_ID }),
      { params: projectParams },
    );
    expect(frameworkDb.createFrameworkRelationship).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ hypothesis_id: HYPOTHESIS_ID }),
    );
  });

  it("does not let a patch move an endpoint", async () => {
    // Changing what a relationship connects is a different claim, not an
    // edit — it stays delete-then-create so both events reach the audit.
    await relRoute.PATCH(req("PATCH", { relationType: "predicts", fromNodeId: OTHER_NODE_ID }), {
      params: relParams,
    });
    expect(frameworkDb.updateFrameworkRelationship).toHaveBeenCalledWith({}, PROJECT_ID, REL_ID, {
      relation_type: "predicts",
    });
  });

  it("returns 404 when the patch matches no row in this project", async () => {
    frameworkDb.updateFrameworkRelationship.mockResolvedValue(null);
    const res = await relRoute.PATCH(req("PATCH", { relationType: "predicts" }), { params: relParams });
    expect(res.status).toBe(404);
  });
});

describe("source search", () => {
  async function search(qs: string) {
    return searchRoute.GET(req("GET", undefined, `http://localhost/x?${qs}`), { params: projectParams });
  }

  it("passes a free-text query through", async () => {
    await search("q=teacher%20motivation");
    expect(citationsDb.searchCitations).toHaveBeenCalledWith(
      {},
      PROJECT_ID,
      expect.objectContaining({ query: "teacher motivation" }),
    );
  });

  it("keeps 'no opinion' distinct from an explicit false", async () => {
    // `hasDoi=false` means "show me the ones missing a DOI"; omitting it means
    // "do not filter on DOI at all". Collapsing them would make the second
    // impossible to express.
    await search("hasDoi=false");
    expect(citationsDb.searchCitations).toHaveBeenCalledWith(
      {},
      PROJECT_ID,
      expect.objectContaining({ hasDoi: false }),
    );

    vi.clearAllMocks();
    citationsDb.searchCitations.mockResolvedValue({ rows: [], total: 0, limit: 25, offset: 0 });
    await search("q=x");
    expect(citationsDb.searchCitations).toHaveBeenCalledWith(
      {},
      PROJECT_ID,
      expect.objectContaining({ hasDoi: null }),
    );
  });

  it("parses a comma-separated filter into a list", async () => {
    await search("sourceTypes=article,book");
    expect(citationsDb.searchCitations).toHaveBeenCalledWith(
      {},
      PROJECT_ID,
      expect.objectContaining({ sourceTypes: ["article", "book"] }),
    );
  });

  it("refuses a limit above the cap rather than silently clamping it", async () => {
    expect((await search("limit=5000")).status).toBe(400);
  });

  it("refuses a non-numeric year", async () => {
    expect((await search("yearFrom=nineteen")).status).toBe(400);
  });

  it("reports whether any filter was applied, so the empty state can be honest", async () => {
    // §19: "no sources match the current filters" is a different statement
    // from "this library is empty", and only the caller knows which applies.
    const unfiltered = await (await search("")).json();
    expect(unfiltered.filtered).toBe(false);

    const filtered = await (await search("q=motivation")).json();
    expect(filtered.filtered).toBe(true);
  });

  it("returns the total for the filters, not the page size", async () => {
    citationsDb.searchCitations.mockResolvedValue({
      rows: [{ id: "c1" }],
      total: 248,
      limit: 25,
      offset: 0,
    });
    const body = await (await search("q=x")).json();
    expect(body.total).toBe(248);
    expect(body.sources).toHaveLength(1);
  });
});

describe("the cross-system review", () => {
  it("recomputes on GET and stores nothing", async () => {
    const res = await systemReviewRoute.GET(req("GET"), { params: projectParams });
    expect(res.status).toBe(200);
    expect(reviewService.buildResearchSystemReview).toHaveBeenCalledWith({}, PROJECT_ID);
    // There is deliberately no POST: running a review changes nothing.
    expect("POST" in systemReviewRoute).toBe(false);
  });

  it("returns a readable error rather than the database's own text", async () => {
    reviewService.buildResearchSystemReview.mockRejectedValue(
      new Error('relation "research_framework_nodes" does not exist'),
    );
    const res = await systemReviewRoute.GET(req("GET"), { params: projectParams });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).not.toContain("research_framework_nodes");
  });
});
