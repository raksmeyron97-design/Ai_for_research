import { describe, expect, it } from "vitest";
import { getSection, listSections, upsertSection } from "../sections";
import { DbError } from "../errors";
import { createSupabaseMock } from "./supabase-mock";

describe("listSections / getSection", () => {
  it("lists all sections for a project", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_sections: { data: [{ id: "s1" }], error: null } },
    });
    expect(await listSections(client, "p1")).toEqual([{ id: "s1" }]);
  });

  it("returns null when the (project, section_type) pair has no row yet", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_sections: { data: null, error: null } },
    });
    expect(await getSection(client, "p1", "methodology")).toBeNull();
  });
});

describe("upsertSection", () => {
  it("upserts on (project_id, section_type)", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { research_sections: { data: { id: "s1" }, error: null } },
    });
    await upsertSection(client, { project_id: "p1", section_type: "methodology", content: "text" });
    const upsertCall = fromCalls[0].builder.calls.find((c) => c.method === "upsert");
    expect(upsertCall?.args[1]).toEqual({ onConflict: "project_id,section_type" });
  });

  it("throws DbError on failure", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_sections: { data: null, error: { message: "denied" } } },
    });
    await expect(
      upsertSection(client, { project_id: "p1", section_type: "methodology" }),
    ).rejects.toThrow(DbError);
  });
});
