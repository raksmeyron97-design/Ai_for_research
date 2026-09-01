import { beforeEach, describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({ requireUserId: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => authMock);

const dbProjects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("@/lib/db/projects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/projects")>();
  return { ...actual, getProject: dbProjects.getProject };
});

const dbSections = vi.hoisted(() => ({ getSection: vi.fn(), upsertSection: vi.fn() }));
vi.mock("@/lib/db/sections", () => dbSections);

const { GET, PUT } = await import("../research/projects/[projectId]/sections/[sectionType]/route");

const params = Promise.resolve({ projectId: "proj-1", sectionType: "results" });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireUserId.mockResolvedValue("user-1");
  authMock.createClient.mockResolvedValue({});
});

describe("GET/PUT /api/research/projects/[projectId]/sections/[sectionType] — cross-project access", () => {
  it("GET returns 404, not another user's section content, when the project isn't the caller's (RLS-denied or nonexistent)", async () => {
    dbProjects.getProject.mockResolvedValue(null);
    const req = new Request("http://localhost/x");
    const res = await GET(req, { params });
    expect(res.status).toBe(404);
    expect(dbSections.getSection).not.toHaveBeenCalled();
  });

  it("PUT returns 404 and never writes when the project isn't the caller's", async () => {
    dbProjects.getProject.mockResolvedValue(null);
    const req = new Request("http://localhost/x", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "attempted cross-project write" }),
    });
    const res = await PUT(req, { params });
    expect(res.status).toBe(404);
    expect(dbSections.upsertSection).not.toHaveBeenCalled();
  });

  it("PUT rejects an unknown section type before ever touching the database", async () => {
    const req = new Request("http://localhost/x", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "x" }),
    });
    const res = await PUT(req, { params: Promise.resolve({ projectId: "proj-1", sectionType: "not_a_real_section" }) });
    expect(res.status).toBe(400);
    expect(dbProjects.getProject).not.toHaveBeenCalled();
  });

  it("PUT rejects content over the 200,000-character cap with a clean 400, not a DB error", async () => {
    dbProjects.getProject.mockResolvedValue({ id: "proj-1" });
    const req = new Request("http://localhost/x", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "x".repeat(200_001) }),
    });
    const res = await PUT(req, { params });
    expect(res.status).toBe(400);
    expect(dbSections.upsertSection).not.toHaveBeenCalled();
  });

  it("PUT succeeds for the caller's own project with valid content", async () => {
    dbProjects.getProject.mockResolvedValue({ id: "proj-1" });
    dbSections.upsertSection.mockResolvedValue({ id: "sec-1", section_type: "results", content: "real content" });
    const req = new Request("http://localhost/x", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: "real content", status: "in_progress" }),
    });
    const res = await PUT(req, { params });
    expect(res.status).toBe(200);
  });
});
