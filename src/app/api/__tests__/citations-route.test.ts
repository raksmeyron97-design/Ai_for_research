import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sources API, added in Phase 16 so the F2 fix is reachable: nothing in the
 * app wrote to `research_citations` before this, so the document-to-source
 * picker would have offered an empty list forever.
 */
const authMock = vi.hoisted(() => ({ requireUserId: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => authMock);

const dbProjects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("@/lib/db/projects", () => dbProjects);

const dbCitations = vi.hoisted(() => ({ listCitations: vi.fn(), upsertCitation: vi.fn() }));
vi.mock("@/lib/db/citations", () => dbCitations);

const { GET, POST } = await import("../research/projects/[projectId]/citations/route");

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const params = Promise.resolve({ projectId: PROJECT_ID });

function post(body: unknown) {
  return new Request("http://localhost/x", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireUserId.mockResolvedValue("user-1");
  authMock.createClient.mockResolvedValue({});
  dbProjects.getProject.mockResolvedValue({ id: PROJECT_ID, user_id: "user-1" });
  dbCitations.listCitations.mockResolvedValue([]);
  dbCitations.upsertCitation.mockImplementation(async (_s: unknown, input: Record<string, unknown>) => ({
    id: "cit-1",
    ...input,
  }));
});

describe("GET /citations", () => {
  it("returns the project's sources", async () => {
    dbCitations.listCitations.mockResolvedValue([{ id: "c1", citation_key: "sok2024antenatal" }]);
    const res = await GET(new Request("http://localhost/x"), { params });
    expect(res.status).toBe(200);
    expect((await res.json()).citations).toHaveLength(1);
  });

  it("returns 404 without touching the database when the project isn't the caller's", async () => {
    dbProjects.getProject.mockResolvedValue(null);
    const res = await GET(new Request("http://localhost/x"), { params });
    expect(res.status).toBe(404);
    expect(dbCitations.listCitations).not.toHaveBeenCalled();
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.requireUserId.mockResolvedValue(null);
    expect((await GET(new Request("http://localhost/x"), { params })).status).toBe(401);
  });
});

describe("POST /citations", () => {
  it("creates a source and marks it user_provided, never verified", async () => {
    const res = await POST(post({ citationKey: "sok2024antenatal", title: "Antenatal study", year: 2024 }), { params });

    expect(res.status).toBe(201);
    const input = dbCitations.upsertCitation.mock.calls[0][1];
    expect(input.citation_key).toBe("sok2024antenatal");
    // "verified" in EvidenceStatus means a claim was checked against the
    // source; typing a title into a form is not that.
    expect(input.status).toBe("user_provided");
  });

  it.each([
    ["a", "too short"],
    ["has spaces", "spaces"],
    ["bad/slash", "slash"],
    ["semi;colon", "punctuation"],
  ])("rejects citation key %s (%s)", async (citationKey) => {
    const res = await POST(post({ citationKey }), { params });
    expect(res.status).toBe(400);
    expect(dbCitations.upsertCitation).not.toHaveBeenCalled();
  });

  it("accepts the character set extractCitationKeys can round-trip", async () => {
    const res = await POST(post({ citationKey: "who_2024-guideline" }), { params });
    expect(res.status).toBe(201);
  });

  it("rejects an implausible year rather than storing it", async () => {
    const res = await POST(post({ citationKey: "abc2024", year: 99999 }), { params });
    expect(res.status).toBe(400);
  });

  it("validates the body before checking project ownership", async () => {
    const res = await POST(post({ citationKey: "" }), { params });
    expect(res.status).toBe(400);
    expect(dbProjects.getProject).not.toHaveBeenCalled();
  });

  it("returns 404 and never writes for a project that isn't the caller's", async () => {
    dbProjects.getProject.mockResolvedValue(null);
    const res = await POST(post({ citationKey: "sok2024antenatal" }), { params });
    expect(res.status).toBe(404);
    expect(dbCitations.upsertCitation).not.toHaveBeenCalled();
  });
});
