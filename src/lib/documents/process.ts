import type { SupabaseClient } from "@supabase/supabase-js";
import { embedTexts } from "../ai/embeddings";
import { deleteChunksForDocument, insertChunks } from "../db/chunks";
import { getDocument, updateDocument } from "../db/documents";
import { chunkText } from "./chunk";
import { ExtractionError, extractText } from "./extract";

/**
 * Runs extraction -> chunking -> embedding -> storage for one document,
 * updating research_documents.extraction_status along the way. Called
 * synchronously from the upload route (see docs/AI_RAG_ARCHITECTURE.md for
 * why — no background job queue exists yet, so a large PDF means a slow
 * HTTP response rather than a silently-stuck "pending" document).
 *
 * Only throws for a caller error (unknown documentId) — that's the one
 * failure mode the caller needs to handle differently. Everything else
 * (storage download, extraction, embedding, chunk storage) is caught and
 * recorded as extraction_status = 'failed' with a reason in
 * extraction_error, so one bad upload doesn't look like a 500 to the
 * caller or leave a document stuck at 'processing' forever.
 */
export async function processDocument(supabase: SupabaseClient, documentId: string): Promise<void> {
  const document = await getDocument(supabase, documentId);
  if (!document) {
    throw new Error(`processDocument: document ${documentId} not found`);
  }

  await updateDocument(supabase, documentId, { extraction_status: "processing" });

  try {
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from("research-documents")
      .download(document.storage_path);

    if (downloadError || !fileBlob) {
      throw new Error(`storage download failed: ${downloadError?.message ?? "no data"}`);
    }

    const buffer = Buffer.from(await fileBlob.arrayBuffer());
    const text = await extractText(buffer, document.mime_type, document.file_name);
    const chunks = chunkText(text);

    if (chunks.length === 0) {
      await updateDocument(supabase, documentId, {
        extraction_status: "completed",
        extracted_text: text,
      });
      return;
    }

    const embeddings = await embedTexts(chunks.map((c) => c.content), "RETRIEVAL_DOCUMENT");

    await deleteChunksForDocument(supabase, documentId);
    await insertChunks(
      supabase,
      chunks.map((chunk, i) => ({
        document_id: documentId,
        project_id: document.project_id,
        chunk_index: chunk.index,
        content: chunk.content,
        token_count: chunk.tokenCount,
        embedding: embeddings[i],
      })),
    );

    await updateDocument(supabase, documentId, {
      extraction_status: "completed",
      extracted_text: text,
    });
  } catch (err) {
    // A failed extraction/embedding is an expected outcome for some
    // uploads (corrupt file, scanned image-only PDF, unsupported
    // encoding) — record it on the row rather than raising past this
    // function, so one bad upload doesn't look like a 500 to the caller.
    const message = err instanceof ExtractionError ? err.message : `processing failed: ${(err as Error).message}`;
    await updateDocument(supabase, documentId, {
      extraction_status: "failed",
      extraction_error: message,
    });
  }
}
