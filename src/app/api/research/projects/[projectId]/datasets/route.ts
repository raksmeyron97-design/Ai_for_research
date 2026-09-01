import { NextResponse } from "next/server";
import { createDataset, listDatasets } from "@/lib/db/datasets";
import { getProject } from "@/lib/db/projects";
import { DatasetParseError, parseDataset } from "@/lib/data/parse-dataset";
import { createClient, requireUserId } from "@/lib/supabase/server";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

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
  const project = await getProject(supabase, projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const datasets = await listDatasets(supabase, projectId);
  return NextResponse.json({ datasets });
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
  const project = await getProject(supabase, projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const formData = await req.formData().catch(() => null);
  const file = formData?.get("file");
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

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseDataset(buffer, file.type || null, file.name);

    const dataset = await createDataset(supabase, {
      project_id: projectId,
      uploaded_by: userId,
      file_name: file.name,
      row_count: parsed.rows.length,
      column_schema: parsed.columns,
      data: parsed.rows,
    });

    return NextResponse.json({ dataset }, { status: 201 });
  } catch (err) {
    if (err instanceof DatasetParseError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    return NextResponse.json({ error: "Dataset upload failed" }, { status: 500 });
  }
}
