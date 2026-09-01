import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const authMock = vi.hoisted(() => ({ requireUserId: vi.fn(), createClient: vi.fn() }));
vi.mock("@/lib/supabase/server", () => authMock);

const dbProjects = vi.hoisted(() => ({ getProject: vi.fn() }));
vi.mock("@/lib/db/projects", () => dbProjects);

const dbDocuments = vi.hoisted(() => ({
  uploadDocument: vi.fn(),
  getDocument: vi.fn(),
  listDocuments: vi.fn(),
}));
vi.mock("@/lib/db/documents", () => dbDocuments);

const processMock = vi.hoisted(() => ({ processDocument: vi.fn() }));
vi.mock("@/lib/documents/process", () => processMock);

const { POST } = await import("../research/projects/[projectId]/documents/route");

function createFakeSupabase(rateLimitCount = 0): SupabaseClient {
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
      insert() {
        return Promise.resolve({ error: null });
      },
      then(onFulfilled: (v: unknown) => unknown) {
        return Promise.resolve({ count: rateLimitCount, error: null }).then(onFulfilled);
      },
    };
    return builder;
  });
  return { from } as unknown as SupabaseClient;
}

function makeUploadRequest(file: File): Request {
  const formData = new FormData();
  formData.set("file", file);
  return new Request("http://localhost/api/research/projects/proj-1/documents", {
    method: "POST",
    body: formData,
  });
}

const params = Promise.resolve({ projectId: "proj-1" });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.requireUserId.mockResolvedValue("user-1");
  authMock.createClient.mockResolvedValue(createFakeSupabase());
  dbProjects.getProject.mockResolvedValue({ id: "proj-1" });
});

describe("POST /api/research/projects/[projectId]/documents — security", () => {
  it("returns 401 when unauthenticated", async () => {
    authMock.requireUserId.mockResolvedValue(null);
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const res = await POST(makeUploadRequest(file), { params });
    expect(res.status).toBe(401);
  });

  it("returns 404 rather than uploading into a project the caller doesn't own", async () => {
    dbProjects.getProject.mockResolvedValue(null);
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const res = await POST(makeUploadRequest(file), { params });
    expect(res.status).toBe(404);
    expect(dbDocuments.uploadDocument).not.toHaveBeenCalled();
  });

  it("rejects a file over the 25MB limit with 413, never attempting to store or process it", async () => {
    // A real 26MB buffer, not a spoofed .size — proves the check reads the actual file size.
    const oversized = new File([new Uint8Array(26 * 1024 * 1024)], "huge.pdf", { type: "application/pdf" });
    const res = await POST(makeUploadRequest(oversized), { params });
    expect(res.status).toBe(413);
    expect(dbDocuments.uploadDocument).not.toHaveBeenCalled();
    expect(processMock.processDocument).not.toHaveBeenCalled();
  });

  it("rejects an empty file", async () => {
    const empty = new File([], "empty.txt", { type: "text/plain" });
    const res = await POST(makeUploadRequest(empty), { params });
    expect(res.status).toBe(400);
  });

  it("returns 429 and never touches storage once the upload rate limit is exhausted", async () => {
    authMock.createClient.mockResolvedValue(createFakeSupabase(999));
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const res = await POST(makeUploadRequest(file), { params });
    expect(res.status).toBe(429);
    expect(dbDocuments.uploadDocument).not.toHaveBeenCalled();
  });

  it("accepts a small, valid file and runs processing", async () => {
    dbDocuments.uploadDocument.mockResolvedValue({ id: "doc-1", project_id: "proj-1" });
    dbDocuments.getDocument.mockResolvedValue({ id: "doc-1", project_id: "proj-1", extraction_status: "completed" });
    const file = new File(["hello world"], "notes.txt", { type: "text/plain" });

    const res = await POST(makeUploadRequest(file), { params });
    expect(res.status).toBe(201);
    expect(processMock.processDocument).toHaveBeenCalledWith(expect.anything(), "doc-1");
  });
});
