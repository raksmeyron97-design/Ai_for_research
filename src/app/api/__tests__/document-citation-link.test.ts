import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PATCH .../documents/[documentId] — the write behind the F2 fix. Linking a
 * document to a source is what gives its retrieved excerpts a citation key.
 */
const authMock = vi.hoisted(() => ({ requireUserId: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => authMock);

const dbProjects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("@/lib/db/projects", () => dbProjects);

const dbDocuments = vi.hoisted(() => ({
  getDocument: vi.fn(),
  updateDocument: vi.fn(),
  deleteDocument: vi.fn(),
}));
vi.mock("@/lib/db/documents", () => dbDocuments);

const dbCitations = vi.hoisted(() => ({ getCitation: vi.fn() }));
vi.mock("@/lib/db/citations", () => dbCitations);

const dbChunks = vi.hoisted(() => ({ deleteChunksForDocument: vi.fn() }));
vi.mock("@/lib/db/chunks", () => dbChunks);

const { PATCH } = await import("../research/projects/[projectId]/documents/[documentId]/route");

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_PROJECT = "99999999-9999-9999-9999-999999999999";
const CITATION_ID = "22222222-2222-2222-2222-222222222222";
const params = Promise.resolve({ projectId: PROJECT_ID, documentId: "doc-1" });

function patch(body: unknown) {
  return new Request("http://localhost/x", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireUserId.mockResolvedValue("user-1");
  authMock.createClient.mockResolvedValue({});
  dbProjects.getProject.mockResolvedValue({ id: PROJECT_ID, user_id: "user-1" });
  dbDocuments.getDocument.mockResolvedValue({ id: "doc-1", project_id: PROJECT_ID });
  dbDocuments.updateDocument.mockImplementation(async (_s: unknown, id: string, p: Record<string, unknown>) => ({
    id,
    project_id: PROJECT_ID,
    ...p,
  }));
  dbCitations.getCitation.mockResolvedValue({ id: CITATION_ID, project_id: PROJECT_ID });
});

describe("PATCH document → citation link", () => {
  it("links a document to a source in the same project", async () => {
    const res = await PATCH(patch({ citationId: CITATION_ID }), { params });
    expect(res.status).toBe(200);
    expect(dbDocuments.updateDocument).toHaveBeenCalledWith(expect.anything(), "doc-1", {
      citation_id: CITATION_ID,
    });
  });

  it("unlinks when given null", async () => {
    const res = await PATCH(patch({ citationId: null }), { params });
    expect(res.status).toBe(200);
    expect(dbDocuments.updateDocument).toHaveBeenCalledWith(expect.anything(), "doc-1", { citation_id: null });
    // No lookup is needed to clear a link.
    expect(dbCitations.getCitation).not.toHaveBeenCalled();
  });

  it("rejects a citation from another of the caller's own projects", async () => {
    // RLS would allow this read — it is the caller's data — but
    // verifyCitationKeys() scopes by project, so the key would never resolve
    // and the excerpt would look fabricated.
    dbCitations.getCitation.mockResolvedValue({ id: CITATION_ID, project_id: OTHER_PROJECT });
    const res = await PATCH(patch({ citationId: CITATION_ID }), { params });

    expect(res.status).toBe(404);
    expect(dbDocuments.updateDocument).not.toHaveBeenCalled();
  });

  it("rejects a citation that does not exist", async () => {
    dbCitations.getCitation.mockResolvedValue(null);
    expect((await PATCH(patch({ citationId: CITATION_ID }), { params })).status).toBe(404);
    expect(dbDocuments.updateDocument).not.toHaveBeenCalled();
  });

  it("returns 404 for a document belonging to a different project", async () => {
    dbDocuments.getDocument.mockResolvedValue({ id: "doc-1", project_id: OTHER_PROJECT });
    expect((await PATCH(patch({ citationId: CITATION_ID }), { params })).status).toBe(404);
    expect(dbDocuments.updateDocument).not.toHaveBeenCalled();
  });

  it("returns 404 when the project isn't the caller's", async () => {
    dbProjects.getProject.mockResolvedValue(null);
    expect((await PATCH(patch({ citationId: CITATION_ID }), { params })).status).toBe(404);
  });

  it("rejects a malformed body", async () => {
    expect((await PATCH(patch({ citationId: "not-a-uuid" }), { params })).status).toBe(400);
    expect((await PATCH(patch({}), { params })).status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    authMock.requireUserId.mockResolvedValue(null);
    expect((await PATCH(patch({ citationId: CITATION_ID }), { params })).status).toBe(401);
  });
});
