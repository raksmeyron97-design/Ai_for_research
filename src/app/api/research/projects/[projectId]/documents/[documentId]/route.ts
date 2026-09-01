import { NextResponse } from "next/server";
import { DbError } from "@/lib/db/errors";
import { deleteDocument, getDocument } from "@/lib/db/documents";
import { getProject } from "@/lib/db/projects";
import { deleteChunksForDocument } from "@/lib/db/chunks";
import { requireUserId } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";

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
