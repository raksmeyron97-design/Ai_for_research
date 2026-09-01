import { describe, expect, it } from "vitest";
import {
  deleteCitation,
  getCitation,
  getCitationsByIds,
  listCitations,
  updateCitation,
  upsertCitation,
} from "../citations";
import { DbError } from "../errors";
import { createSupabaseMock } from "./supabase-mock";

describe("listCitations / getCitation", () => {
  it("lists citations for a project", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_citations: { data: [{ id: "c1" }, { id: "c2" }], error: null } },
    });
    expect(await listCitations(client, "p1")).toHaveLength(2);
  });

  it("returns null when a citation is not found", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_citations: { data: null, error: null } },
    });
    expect(await getCitation(client, "missing")).toBeNull();
  });
});

describe("getCitationsByIds", () => {
  it("returns an empty array without querying for an empty id list", async () => {
    const { client, fromCalls } = createSupabaseMock({});
    const result = await getCitationsByIds(client, []);
    expect(result).toEqual([]);
    expect(fromCalls).toHaveLength(0);
  });

  it("queries with .in() for the given ids", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { research_citations: { data: [{ id: "c1" }], error: null } },
    });
    await getCitationsByIds(client, ["c1", "c2"]);
    const inCall = fromCalls[0].builder.calls.find((c) => c.method === "in");
    expect(inCall?.args).toEqual(["id", ["c1", "c2"]]);
  });
});

describe("upsertCitation", () => {
  it("upserts on (project_id, citation_key)", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { research_citations: { data: { id: "c1" }, error: null } },
    });
    await upsertCitation(client, { project_id: "p1", citation_key: "who2024" });
    const upsertCall = fromCalls[0].builder.calls.find((c) => c.method === "upsert");
    expect(upsertCall?.args[1]).toEqual({ onConflict: "project_id,citation_key" });
  });

  it("throws DbError on failure", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_citations: { data: null, error: { message: "denied" } } },
    });
    await expect(upsertCitation(client, { project_id: "p1", citation_key: "x" })).rejects.toThrow(DbError);
  });
});

describe("updateCitation / deleteCitation", () => {
  it("updateCitation sends only the patch fields", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { research_citations: { data: { id: "c1", status: "verified" }, error: null } },
    });
    await updateCitation(client, "c1", { status: "verified" });
    const updateCall = fromCalls[0].builder.calls.find((c) => c.method === "update");
    expect(updateCall?.args[0]).toEqual({ status: "verified" });
  });

  it("deleteCitation throws DbError on failure", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_citations: { data: null, error: { message: "denied" } } },
    });
    await expect(deleteCitation(client, "c1")).rejects.toThrow(DbError);
  });
});
