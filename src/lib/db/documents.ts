import type { SupabaseClient } from "@supabase/supabase-js";
import { DbError, toDbError } from "./errors";
import type {
  ResearchDocumentInsert,
  ResearchDocumentRow,
  ResearchDocumentUpdate,
} from "./types";

const TABLE = "research_documents";
const BUCKET = "research-documents";

export async function listDocuments(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchDocumentRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw toDbError(error, "listDocuments");
  return data as ResearchDocumentRow[];
}

export async function getDocument(
  supabase: SupabaseClient,
  documentId: string,
): Promise<ResearchDocumentRow | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", documentId)
    .maybeSingle();

  if (error) throw toDbError(error, "getDocument");
  return data as ResearchDocumentRow | null;
}

/**
 * Builds the storage.objects path the storage RLS policies expect:
 * `{project_id}/{uuid}-{original_filename}`. The project_id prefix is
 * exactly what `storage.foldername(name)[1]` reads back out in
 * supabase/migrations/*_phase2_storage.sql — keep this in sync with that
 * migration if the convention ever changes.
 */
export function buildStoragePath(projectId: string, fileName: string): string {
  const safeName = fileName.replace(/[^a-zA-Z0-9.\-_]/g, "_");
  return `${projectId}/${crypto.randomUUID()}-${safeName}`;
}

/**
 * Uploads file bytes to Storage, then inserts the metadata row. If the DB
 * insert fails (e.g. RLS rejects a project_id the caller doesn't own),
 * the just-uploaded object is removed so it doesn't become an orphaned
 * file with no corresponding row.
 */
export async function uploadDocument(
  supabase: SupabaseClient,
  file: Blob,
  input: Omit<ResearchDocumentInsert, "storage_path">,
): Promise<ResearchDocumentRow> {
  const storagePath = buildStoragePath(input.project_id, input.file_name);

  const { error: uploadError } = await supabase.storage.from(BUCKET).upload(storagePath, file, {
    contentType: input.mime_type ?? undefined,
    upsert: false,
  });
  if (uploadError) {
    throw new DbError(`uploadDocument: storage upload failed: ${uploadError.message}`);
  }

  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...input, storage_path: storagePath })
    .select("*")
    .single();

  if (error) {
    await supabase.storage.from(BUCKET).remove([storagePath]);
    throw toDbError(error, "uploadDocument");
  }

  return data as ResearchDocumentRow;
}

export async function updateDocument(
  supabase: SupabaseClient,
  documentId: string,
  patch: ResearchDocumentUpdate,
): Promise<ResearchDocumentRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", documentId)
    .select("*")
    .single();

  if (error) throw toDbError(error, "updateDocument");
  return data as ResearchDocumentRow;
}

/** Deletes the storage object first, then the row — the reverse order of upload, for the same "no orphan" reason. */
export async function deleteDocument(supabase: SupabaseClient, documentId: string): Promise<void> {
  const existing = await getDocument(supabase, documentId);
  if (!existing) throw new DbError("deleteDocument: not found", true);

  const { error: storageError } = await supabase.storage.from(BUCKET).remove([existing.storage_path]);
  if (storageError) {
    throw new DbError(`deleteDocument: storage removal failed: ${storageError.message}`);
  }

  const { error } = await supabase.from(TABLE).delete().eq("id", documentId);
  if (error) throw toDbError(error, "deleteDocument");
}

/**
 * Removes every stored file for a project's documents, without touching
 * the DB rows — used by `deleteProject()` (Phase 15 §3, secure deletion):
 * a project delete cascades every child row via FK constraints, but
 * Postgres cascade cannot reach Supabase Storage, so the actual file
 * bytes would otherwise survive forever as orphans no RLS policy can
 * even reach anymore once the owning project row is gone.
 */
export async function removeAllDocumentStorage(supabase: SupabaseClient, projectId: string): Promise<void> {
  const documents = await listDocuments(supabase, projectId);
  if (documents.length === 0) return;

  const { error } = await supabase.storage.from(BUCKET).remove(documents.map((d) => d.storage_path));
  if (error) {
    throw new DbError(`removeAllDocumentStorage: ${error.message}`);
  }
}

/** Signed URL for a private document, for previewing/downloading in the UI. */
export async function getDocumentDownloadUrl(
  supabase: SupabaseClient,
  storagePath: string,
  expiresInSeconds = 3600,
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);

  if (error || !data) {
    throw new DbError(`getDocumentDownloadUrl: ${error?.message ?? "unknown error"}`);
  }
  return data.signedUrl;
}
