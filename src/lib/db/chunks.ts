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

/**
 * The first `limit` chunks of the given documents, in document order.
 *
 * Used to hand a source's own text to profile extraction without an embedding
 * call: the question there is "what does this paper say", not "what in this
 * paper matches a query", so a similarity search would be the wrong tool and a
 * paid one. `limit` is per call and deliberately small — §36's rule is the
 * fewest useful excerpts, not the whole document.
 */
export async function listChunksForDocuments(
  supabase: SupabaseClient,
  projectId: string,
  documentIds: string[],
  limit = 4,
): Promise<{ id: string; document_id: string; content: string; page: number | null; section: string | null }[]> {
  if (documentIds.length === 0) return [];

  const { data, error } = await supabase
    .from(TABLE)
    .select("id, document_id, content, page, section")
    .eq("project_id", projectId)
    .in("document_id", documentIds)
    .order("chunk_index", { ascending: true })
    .limit(limit);

  if (error) throw toDbError(error, "listChunksForDocuments");
  return (data ?? []) as { id: string; document_id: string; content: string; page: number | null; section: string | null }[];
}
