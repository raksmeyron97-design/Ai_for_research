import { beforeEach, describe, expect, it, vi } from "vitest";

const dbDocuments = vi.hoisted(() => ({
  getDocument: vi.fn(),
  updateDocument: vi.fn(async (_supabase: unknown, _id: string, _patch: Record<string, unknown>) => ({})),
}));
vi.mock("../../db/documents", () => dbDocuments);

const dbChunks = vi.hoisted(() => ({
  deleteChunksForDocument: vi.fn(async (_supabase: unknown, _documentId: string) => {}),
  insertChunks: vi.fn(async (_supabase: unknown, _chunks: Record<string, unknown>[]) => {}),
}));
vi.mock("../../db/chunks", () => dbChunks);

const extractMock = vi.hoisted(() => ({
  extractText: vi.fn(async () => "extracted text content"),
  ExtractionError: class ExtractionError extends Error {},
}));
vi.mock("../extract", () => extractMock);

const chunkMock = vi.hoisted(() => ({
  chunkText: vi.fn(() => [{ index: 0, content: "chunk one", tokenCount: 3 }]),
}));
vi.mock("../chunk", () => chunkMock);

const embeddingsMock = vi.hoisted(() => ({
  embedTexts: vi.fn(async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3])),
}));
vi.mock("../../ai/embeddings", () => embeddingsMock);

const { processDocument } = await import("../process");

function makeSupabase(downloadResult: { data: unknown; error: unknown } = { data: new Blob(["x"]), error: null }) {
  return {
    storage: {
      from: vi.fn(() => ({
        download: vi.fn(async () => downloadResult),
      })),
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  dbDocuments.getDocument.mockResolvedValue({
    id: "doc-1",
    project_id: "proj-1",
    storage_path: "proj-1/file.pdf",
    mime_type: "application/pdf",
    file_name: "file.pdf",
  });
  chunkMock.chunkText.mockReturnValue([{ index: 0, content: "chunk one", tokenCount: 3 }]);
  extractMock.extractText.mockResolvedValue("extracted text content");
});

describe("processDocument", () => {
  it("throws when the document does not exist", async () => {
    dbDocuments.getDocument.mockResolvedValueOnce(null);
    await expect(processDocument(makeSupabase(), "missing")).rejects.toThrow(/not found/);
  });

  it("marks the document processing, then completed, on the happy path", async () => {
    await processDocument(makeSupabase(), "doc-1");

    const calls = dbDocuments.updateDocument.mock.calls;
    expect(calls[0][2]).toEqual({ extraction_status: "processing" });
    expect(calls.at(-1)?.[2]).toMatchObject({
      extraction_status: "completed",
      extracted_text: "extracted text content",
    });
  });

  it("deletes old chunks and inserts new ones with embeddings", async () => {
    await processDocument(makeSupabase(), "doc-1");

    expect(dbChunks.deleteChunksForDocument).toHaveBeenCalledWith(expect.anything(), "doc-1");
    expect(dbChunks.insertChunks).toHaveBeenCalledTimes(1);
    const inserted = dbChunks.insertChunks.mock.calls[0][1];
    expect(inserted).toEqual([
      expect.objectContaining({
        document_id: "doc-1",
        project_id: "proj-1",
        chunk_index: 0,
        content: "chunk one",
        embedding: [0.1, 0.2, 0.3],
      }),
    ]);
  });

  it("skips embedding/chunk storage entirely when extraction produces no chunks", async () => {
    chunkMock.chunkText.mockReturnValueOnce([]);

    await processDocument(makeSupabase(), "doc-1");

    expect(embeddingsMock.embedTexts).not.toHaveBeenCalled();
    expect(dbChunks.insertChunks).not.toHaveBeenCalled();
    const lastUpdate = dbDocuments.updateDocument.mock.calls.at(-1)?.[2];
    expect(lastUpdate).toEqual({ extraction_status: "completed", extracted_text: "extracted text content" });
  });

  it("records a failure instead of throwing when extraction fails", async () => {
    extractMock.extractText.mockRejectedValueOnce(new extractMock.ExtractionError("bad PDF"));

    await expect(processDocument(makeSupabase(), "doc-1")).resolves.toBeUndefined();

    const lastUpdate = dbDocuments.updateDocument.mock.calls.at(-1)?.[2];
    expect(lastUpdate).toEqual({ extraction_status: "failed", extraction_error: "bad PDF" });
  });

  it("records a failure instead of throwing when the storage download fails", async () => {
    const supabase = makeSupabase({ data: null, error: { message: "not found in bucket" } });

    await expect(processDocument(supabase, "doc-1")).resolves.toBeUndefined();

    const lastUpdate = dbDocuments.updateDocument.mock.calls.at(-1)?.[2];
    expect(lastUpdate?.extraction_status).toBe("failed");
    expect(lastUpdate?.extraction_error).toMatch(/storage download failed/);
  });

  it("records a failure instead of throwing when embedding fails", async () => {
    embeddingsMock.embedTexts.mockRejectedValueOnce(new Error("embedding API down"));

    await expect(processDocument(makeSupabase(), "doc-1")).resolves.toBeUndefined();

    const lastUpdate = dbDocuments.updateDocument.mock.calls.at(-1)?.[2];
    expect(lastUpdate?.extraction_status).toBe("failed");
  });
});
