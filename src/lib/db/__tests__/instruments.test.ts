import { describe, expect, it } from "vitest";
import { createInstrument, deleteInstrument, getInstrument, listInstruments } from "../instruments";
import { DbError } from "../errors";
import { createSupabaseMock } from "./supabase-mock";

describe("listInstruments / getInstrument", () => {
  it("lists instruments for a project", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_instruments: { data: [{ id: "i1" }], error: null } },
    });
    expect(await listInstruments(client, "p1")).toEqual([{ id: "i1" }]);
  });

  it("returns null when an instrument is not found", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_instruments: { data: null, error: null } },
    });
    expect(await getInstrument(client, "missing")).toBeNull();
  });
});

describe("createInstrument", () => {
  it("inserts the given fields", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { research_instruments: { data: { id: "i1" }, error: null } },
    });
    await createInstrument(client, { project_id: "p1", name: "Survey" });
    const insertCall = fromCalls[0].builder.calls.find((c) => c.method === "insert");
    expect(insertCall?.args[0]).toEqual({ project_id: "p1", name: "Survey" });
  });

  it("throws DbError on failure (e.g. the source_reference CHECK constraint)", async () => {
    const { client } = createSupabaseMock({
      tableResults: {
        research_instruments: {
          data: null,
          error: { message: "new row violates check constraint \"source_reference_required_unless_researcher_developed\"" },
        },
      },
    });
    await expect(
      createInstrument(client, { project_id: "p1", name: "Survey", validation_status: "validated" }),
    ).rejects.toThrow(DbError);
  });
});

describe("deleteInstrument", () => {
  it("throws DbError on failure", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_instruments: { data: null, error: { message: "denied" } } },
    });
    await expect(deleteInstrument(client, "i1")).rejects.toThrow(DbError);
  });
});
