import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError } from "./errors";
import type { ChunkSearchResult, DocumentChunkInsert } from "./types";

const TABLE = "document_chunks";

/** Bulk insert — process.ts calls this once per document with all of its chunks+embeddings already computed. */
export async function insertChunks(
  supabase: SupabaseClient,
  chunks: DocumentChunkInsert[],
): Promise<void> {
  if (chunks.length === 0) return;
  const { error } = await supabase.from(TABLE).insert(chunks);
  if (error) throw toDbError(error, "insertChunks");
}

/** Called before re-inserting on re-processing, so a document never ends up with a mix of stale and fresh chunks. */
export async function deleteChunksForDocument(
  supabase: SupabaseClient,
  documentId: string,
): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("document_id", documentId);
  if (error) throw toDbError(error, "deleteChunksForDocument");
}

/**
 * Semantic search via the match_document_chunks() Postgres function
 * (supabase/migrations/*_phase3_document_chunks.sql) — supabase-js's
 * fluent query builder has no vector-distance operator, so this goes
 * through .rpc() instead of .from(). The function is SECURITY INVOKER,
 * so RLS still applies; a project_id the caller doesn't own returns []
 * rather than throwing.
 */
export async function searchChunks(
  supabase: SupabaseClient,
  projectId: string,
  queryEmbedding: number[],
  matchCount = 8,
): Promise<ChunkSearchResult[]> {
  const { data, error } = await supabase.rpc("match_document_chunks", {
    query_embedding: queryEmbedding,
    match_project_id: projectId,
    match_count: matchCount,
  });

  if (error) throw toDbError(error, "searchChunks");
  return (data ?? []) as ChunkSearchResult[];
}
