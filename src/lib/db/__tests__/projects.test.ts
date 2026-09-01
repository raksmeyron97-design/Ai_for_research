import { describe, expect, it } from "vitest";
import { DbError } from "../errors";
import {
  createProject,
  deleteProject,
  getProject,
  getProjectProgress,
  listProjects,
  SECTION_CHAIN,
  updateProject,
} from "../projects";
import { createSupabaseMock } from "./supabase-mock";

describe("createProject", () => {
  it("merges the given userId into the insert payload", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: {
        research_projects: { data: { id: "p1", title: "Thesis" }, error: null },
      },
    });

    await createProject(client, "user-123", { title: "Thesis" });

    const insertCall = fromCalls[0].builder.calls.find((c) => c.method === "insert");
    expect(insertCall?.args[0]).toEqual({ title: "Thesis", user_id: "user-123" });
  });

  it("throws a DbError when the insert fails", async () => {
    const { client } = createSupabaseMock({
      tableResults: {
        research_projects: { data: null, error: { message: "insert failed" } },
      },
    });

    await expect(createProject(client, "user-123", { title: "Thesis" })).rejects.toThrow(DbError);
  });
});

describe("getProject", () => {
  it("returns null when no row is found (maybeSingle with no data)", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_projects: { data: null, error: null } },
    });
    const result = await getProject(client, "missing-id");
    expect(result).toBeNull();
  });

  it("returns the row when found", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_projects: { data: { id: "p1" }, error: null } },
    });
    const result = await getProject(client, "p1");
    expect(result).toEqual({ id: "p1" });
  });
});

describe("listProjects / updateProject / deleteProject", () => {
  it("listProjects returns the mocked rows", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_projects: { data: [{ id: "p1" }, { id: "p2" }], error: null } },
    });
    const result = await listProjects(client);
    expect(result).toHaveLength(2);
  });

  it("updateProject sends only the patch fields", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { research_projects: { data: { id: "p1", status: "completed" }, error: null } },
    });
    await updateProject(client, "p1", { status: "completed" });
    const updateCall = fromCalls[0].builder.calls.find((c) => c.method === "update");
    expect(updateCall?.args[0]).toEqual({ status: "completed" });
  });

  it("deleteProject throws DbError when the row delete fails", async () => {
    const { client } = createSupabaseMock({
      tableResults: {
        research_projects: { data: null, error: { message: "denied" } },
        research_documents: { data: [], error: null },
      },
    });
    await expect(deleteProject(client, "p1")).rejects.toThrow(DbError);
  });

  it("deleteProject removes every stored document file before deleting the row (Phase 15 — secure deletion)", async () => {
    const { client, storageRemove } = createSupabaseMock({
      tableResults: {
        research_projects: { data: null, error: null },
        research_documents: {
          data: [
            { id: "d1", storage_path: "p1/a.pdf" },
            { id: "d2", storage_path: "p1/b.pdf" },
          ],
          error: null,
        },
      },
    });
    await deleteProject(client, "p1");
    expect(storageRemove).toHaveBeenCalledWith(["p1/a.pdf", "p1/b.pdf"]);
  });

  it("deleteProject does not touch storage when the project has no documents", async () => {
    const { client, storageRemove } = createSupabaseMock({
      tableResults: {
        research_projects: { data: null, error: null },
        research_documents: { data: [], error: null },
      },
    });
    await deleteProject(client, "p1");
    expect(storageRemove).not.toHaveBeenCalled();
  });

  it("deleteProject leaves the project row intact when removing its stored documents fails", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: {
        research_projects: { data: null, error: null },
        research_documents: { data: [{ id: "d1", storage_path: "p1/a.pdf" }], error: null },
      },
      storage: { remove: { message: "storage backend unavailable" } },
    });
    await expect(deleteProject(client, "p1")).rejects.toThrow(DbError);
    const projectDeleteCall = fromCalls
      .find((c) => c.table === "research_projects")
      ?.builder.calls.find((c) => c.method === "delete");
    expect(projectDeleteCall).toBeUndefined();
  });
});

describe("getProjectProgress", () => {
  it("computes percent complete from research_sections rows only, treating missing sections as not_started", async () => {
    const { client } = createSupabaseMock({
      tableResults: {
        research_sections: {
          data: [
            { section_type: "title", status: "completed" },
            { section_type: "research_problem", status: "completed" },
            { section_type: "rationale", status: "in_progress" },
            // remaining SECTION_CHAIN entries have no row -> not_started
          ],
          error: null,
        },
      },
    });

    const progress = await getProjectProgress(client, "p1");
    expect(progress.totalSections).toBe(SECTION_CHAIN.length);
    expect(progress.completedSections).toBe(2);
    expect(progress.inProgressSections).toBe(1);
    expect(progress.percent).toBe(Math.round((2 / SECTION_CHAIN.length) * 100));
  });

  it("is 0% for a project with no sections yet", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_sections: { data: [], error: null } },
    });
    const progress = await getProjectProgress(client, "p1");
    expect(progress.percent).toBe(0);
  });

  it("is 100% when every section in the chain is completed", async () => {
    const { client } = createSupabaseMock({
      tableResults: {
        research_sections: {
          data: SECTION_CHAIN.map((section_type) => ({ section_type, status: "completed" })),
          error: null,
        },
      },
    });
    const progress = await getProjectProgress(client, "p1");
    expect(progress.percent).toBe(100);
  });
});
