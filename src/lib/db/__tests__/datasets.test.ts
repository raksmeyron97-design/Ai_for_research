import { describe, expect, it } from "vitest";
import { createDataset, deleteDataset, getDataset, listDatasets } from "../datasets";
import { DbError } from "../errors";
import { createSupabaseMock } from "./supabase-mock";

describe("listDatasets / getDataset", () => {
  it("lists datasets for a project", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_datasets: { data: [{ id: "d1" }], error: null } },
    });
    expect(await listDatasets(client, "p1")).toEqual([{ id: "d1" }]);
  });

  it("returns null when a dataset is not found", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_datasets: { data: null, error: null } },
    });
    expect(await getDataset(client, "missing")).toBeNull();
  });
});

describe("createDataset", () => {
  it("inserts the given fields", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { research_datasets: { data: { id: "d1" }, error: null } },
    });
    const input = {
      project_id: "p1",
      uploaded_by: "u1",
      file_name: "data.csv",
      row_count: 3,
      column_schema: [{ name: "age", type: "numeric" as const, missingCount: 0 }],
      data: [{ age: 1 }],
    };
    await createDataset(client, input);
    const insertCall = fromCalls[0].builder.calls.find((c) => c.method === "insert");
    expect(insertCall?.args[0]).toEqual(input);
  });

  it("throws DbError on failure", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_datasets: { data: null, error: { message: "denied" } } },
    });
    await expect(
      createDataset(client, {
        project_id: "p1",
        uploaded_by: "u1",
        file_name: "x.csv",
        row_count: 0,
        column_schema: [],
        data: [],
      }),
    ).rejects.toThrow(DbError);
  });
});

describe("deleteDataset", () => {
  it("throws DbError on failure", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_datasets: { data: null, error: { message: "denied" } } },
    });
    await expect(deleteDataset(client, "d1")).rejects.toThrow(DbError);
  });
});
