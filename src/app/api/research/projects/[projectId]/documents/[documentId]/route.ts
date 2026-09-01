import { NextResponse } from "next/server";
import { z } from "zod";
import { DbError } from "@/lib/db/errors";
import { getCitation } from "@/lib/db/citations";
import { deleteDocument, getDocument, updateDocument } from "@/lib/db/documents";
import { getProject } from "@/lib/db/projects";
import { deleteChunksForDocument } from "@/lib/db/chunks";
import { requireUserId } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";

/** Null unlinks the document from its source, making its excerpts uncitable again. */
const patchSchema = z.object({
  citationId: z.string().uuid().nullable(),
});

/**
 * Links a document to the source record it is (or unlinks it). This is what
 * makes retrieved excerpts citable: `match_document_chunks` joins through
 * `research_documents.citation_id` to return a `citation_key` per chunk, and
 * `context-manager.ts` labels the excerpt with it, so a grounded answer can
 * emit a key that `verifyCitationKeys()` resolves (Phase 16 finding F2).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; documentId: string }> },
) {
  const { projectId, documentId } = await params;

  let userId: string | null;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();

  const project = await getProject(supabase, projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const document = await getDocument(supabase, documentId);
  if (!document || document.project_id !== projectId) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  // RLS already stops a citation belonging to another user, but a citation
  // from another of this user's own projects would pass RLS and produce a
  // key that verifyCitationKeys() — which scopes by project_id — would then
  // report as unverified. Reject it here instead of storing the mismatch.
  if (parsed.data.citationId !== null) {
    const citation = await getCitation(supabase, parsed.data.citationId);
    if (!citation || citation.project_id !== projectId) {
      return NextResponse.json({ error: "Citation not found in this project" }, { status: 404 });
    }
  }

  try {
    const updated = await updateDocument(supabase, documentId, { citation_id: parsed.data.citationId });
    return NextResponse.json(updated);
  } catch (err) {
    const dbErr = err as DbError;
    return NextResponse.json({ error: dbErr.message }, { status: dbErr.notFound ? 404 : 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; documentId: string }> },
) {
  const { projectId, documentId } = await params;

  let userId: string | null;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const project = await getProject(supabase, projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const document = await getDocument(supabase, documentId);
  if (!document || document.project_id !== projectId) {
    return NextResponse.json({ error: "Document not found" }, { status: 404 });
  }

  try {
    await deleteChunksForDocument(supabase, documentId);
    await deleteDocument(supabase, documentId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    const dbErr = err as DbError;
    return NextResponse.json({ error: dbErr.message }, { status: dbErr.notFound ? 404 : 500 });
  }
}
