import { NextResponse } from "next/server";
import { z } from "zod";
import { DbError } from "@/lib/db/errors";
import { getProject } from "@/lib/db/projects";
import { getDocument, listDocuments, uploadDocument } from "@/lib/db/documents";
import type { DocumentType } from "@/lib/db/types";
import { processDocument } from "@/lib/documents/process";
import { requireUserId } from "@/lib/supabase/server";
import { createClient } from "@/lib/supabase/server";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024; // 25MB

const DOCUMENT_TYPES = [
  "thesis", "article", "guideline", "questionnaire",
  "dataset", "reference", "template", "other",
] as const satisfies readonly DocumentType[];

const uploadFieldsSchema = z.object({
  document_type: z.enum(DOCUMENT_TYPES).default("other"),
});

async function requireOwnedProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  projectId: string,
) {
  const project = await getProject(supabase, projectId);
  return project; // null covers both "doesn't exist" and "not yours" — RLS already enforces this, so both cases just look like 404.
}

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  let userId: string | null;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const project = await requireOwnedProject(supabase, projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const documents = await listDocuments(supabase, projectId);
    return NextResponse.json({ documents });
  } catch (err) {
    return NextResponse.json({ error: (err as DbError).message }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  let userId: string | null;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const project = await requireOwnedProject(supabase, projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const formData = await req.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Missing 'file' field" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "File is empty" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)}MB upload limit` },
      { status: 413 },
    );
  }

  const parsedFields = uploadFieldsSchema.safeParse({
    document_type: formData.get("document_type") ?? undefined,
  });
  if (!parsedFields.success) {
    return NextResponse.json({ error: "Invalid fields", details: parsedFields.error.flatten() }, { status: 400 });
  }

  try {
    const document = await uploadDocument(supabase, file, {
      project_id: projectId,
      uploaded_by: userId,
      file_name: file.name,
      mime_type: file.type || null,
      size_bytes: file.size,
      document_type: parsedFields.data.document_type,
    });

    // Synchronous: no background job queue exists yet (see
    // docs/AI_RAG_ARCHITECTURE.md). Extraction/embedding failure is
    // recorded on the row, not thrown — see processDocument().
    await processDocument(supabase, document.id);

    const finalDocument = await getDocument(supabase, document.id);
    return NextResponse.json({ document: finalDocument ?? document }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as DbError).message }, { status: 500 });
  }
}
