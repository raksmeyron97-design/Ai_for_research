import { describe, expect, it } from "vitest";
import {
  buildStoragePath,
  deleteDocument,
  getDocumentDownloadUrl,
  uploadDocument,
} from "../documents";
import { DbError } from "../errors";
import { createSupabaseMock } from "./supabase-mock";

describe("buildStoragePath", () => {
  it("prefixes the path with the project id", () => {
    const path = buildStoragePath("proj-1", "my file.pdf");
    expect(path.startsWith("proj-1/")).toBe(true);
  });

  it("sanitizes unsafe characters out of the filename", () => {
    const path = buildStoragePath("proj-1", "weird name (draft)!.pdf");
    expect(path).not.toMatch(/[()!\s]/);
  });
});

describe("uploadDocument", () => {
  const baseInput = {
    project_id: "proj-1",
    uploaded_by: "user-1",
    file_name: "thesis-draft.pdf",
    mime_type: "application/pdf",
  };

  it("inserts a row with the generated storage_path on success", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: {
        research_documents: { data: { id: "doc-1", ...baseInput }, error: null },
      },
      storage: { upload: null },
    });

    const result = await uploadDocument(client, new Blob(["x"]), baseInput);

    expect(result.id).toBe("doc-1");
    const insertCall = fromCalls[0].builder.calls.find((c) => c.method === "insert");
    const payload = insertCall?.args[0] as Record<string, unknown>;
    expect(String(payload.storage_path)).toMatch(/^proj-1\//);
  });

  it("throws without attempting a DB insert when the storage upload itself fails", async () => {
    const { client, fromCalls } = createSupabaseMock({
      tableResults: {
        research_documents: { data: { id: "doc-1" }, error: null },
      },
      storage: { upload: { message: "bucket full" } },
    });

    await expect(uploadDocument(client, new Blob(["x"]), baseInput)).rejects.toThrow(DbError);
    expect(fromCalls).toHaveLength(0);
  });

  it("rolls back the uploaded object when the DB insert fails", async () => {
    const { client, storageRemove } = createSupabaseMock({
      tableResults: {
        research_documents: { data: null, error: { message: "RLS denied" } },
      },
      storage: { upload: null },
    });

    await expect(uploadDocument(client, new Blob(["x"]), baseInput)).rejects.toThrow(DbError);
    expect(storageRemove).toHaveBeenCalledTimes(1);
    const removedPaths = storageRemove.mock.calls[0][0] as string[];
    expect(removedPaths[0]).toMatch(/^proj-1\//);
  });
});

describe("deleteDocument", () => {
  it("throws a not-found DbError when the document does not exist", async () => {
    const { client } = createSupabaseMock({
      tableResults: { research_documents: { data: null, error: null } },
    });

    const err = await deleteDocument(client, "missing").catch((e) => e);
    expect(err).toBeInstanceOf(DbError);
    expect((err as DbError).notFound).toBe(true);
  });

  it("removes the storage object before deleting the row", async () => {
    const { client, storageRemove } = createSupabaseMock({
      tableResults: {
        research_documents: { data: { id: "doc-1", storage_path: "proj-1/abc-file.pdf" }, error: null },
      },
    });

    await deleteDocument(client, "doc-1");
    expect(storageRemove).toHaveBeenCalledWith(["proj-1/abc-file.pdf"]);
  });
});

describe("getDocumentDownloadUrl", () => {
  it("returns the signed url on success", async () => {
    const { client } = createSupabaseMock({
      tableResults: {},
      storage: { signedUrl: { url: "https://example.com/signed" } },
    });
    const url = await getDocumentDownloadUrl(client, "proj-1/file.pdf");
    expect(url).toBe("https://example.com/signed");
  });

  it("throws a DbError when signing fails", async () => {
    const { client } = createSupabaseMock({
      tableResults: {},
      storage: { signedUrl: { error: { message: "not found" } } },
    });
    await expect(getDocumentDownloadUrl(client, "proj-1/file.pdf")).rejects.toThrow(DbError);
  });
});
