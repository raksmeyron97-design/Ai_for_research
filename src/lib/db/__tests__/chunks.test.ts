import { describe, expect, it } from "vitest";
import { deleteChunksForDocument, insertChunks, searchChunks } from "../chunks";
import { DbError } from "../errors";
import { createSupabaseMock } from "./supabase-mock";

describe("insertChunks", () => {
  it("does nothing for an empty array (no insert call at all)", async () => {
    const { client, fromCalls } = createSupabaseMock({});
    await insertChunks(client, []);
    expect(fromCalls).toHaveLength(0);
  });

  it("inserts all given chunks in one call", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { document_chunks: { data: null, error: null } },
    });
    const chunks = [
      { document_id: "d1", project_id: "p1", chunk_index: 0, content: "a", embedding: [0.1] },
      { document_id: "d1", project_id: "p1", chunk_index: 1, content: "b", embedding: [0.2] },
    ];
    await insertChunks(client, chunks);
    const insertCall = fromCalls[0].builder.calls.find((c) => c.method === "insert");
    expect(insertCall?.args[0]).toEqual(chunks);
  });

  it("throws DbError on failure", async () => {
    const { client } = createSupabaseMock({
      tableResults: { document_chunks: { data: null, error: { message: "insert failed" } } },
    });
    await expect(
      insertChunks(client, [{ document_id: "d1", project_id: "p1", chunk_index: 0, content: "a", embedding: [0.1] }]),
    ).rejects.toThrow(DbError);
  });
});

describe("deleteChunksForDocument", () => {
  it("filters by document_id", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: { document_chunks: { data: null, error: null } },
    });
    await deleteChunksForDocument(client, "doc-1");
    const eqCall = fromCalls[0].builder.calls.find((c) => c.method === "eq");
    expect(eqCall?.args).toEqual(["document_id", "doc-1"]);
  });
});

describe("searchChunks", () => {
  it("calls the match_document_chunks RPC with the expected arguments", async () => {
    const { client, rpc } = createSupabaseMock({
      rpcResult: { data: [{ id: "c1", similarity: 0.9 }], error: null },
    });
    const result = await searchChunks(client, "proj-1", [0.1, 0.2], 5);
    expect(rpc).toHaveBeenCalledWith("match_document_chunks", {
      query_embedding: [0.1, 0.2],
      match_project_id: "proj-1",
      match_count: 5,
    });
    expect(result).toEqual([{ id: "c1", similarity: 0.9 }]);
  });

  it("defaults match_count to 8", async () => {
    const { client, rpc } = createSupabaseMock({ rpcResult: { data: [], error: null } });
    await searchChunks(client, "proj-1", [0.1]);
    expect(rpc).toHaveBeenCalledWith("match_document_chunks", expect.objectContaining({ match_count: 8 }));
  });

  it("returns an empty array when data is null", async () => {
    const { client } = createSupabaseMock({ rpcResult: { data: null, error: null } });
    const result = await searchChunks(client, "proj-1", [0.1]);
    expect(result).toEqual([]);
  });

  it("throws DbError when the RPC errors", async () => {
    const { client } = createSupabaseMock({ rpcResult: { data: null, error: { message: "rpc failed" } } });
    await expect(searchChunks(client, "proj-1", [0.1])).rejects.toThrow(DbError);
  });
});
