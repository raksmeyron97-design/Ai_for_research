import { NextResponse } from "next/server";
import { summarizeDataset } from "@/lib/data/descriptive-stats";
import { deleteDataset, getDataset } from "@/lib/db/datasets";
import { getProject } from "@/lib/db/projects";
import { createClient, requireUserId } from "@/lib/supabase/server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; datasetId: string }> },
) {
  const { projectId, datasetId } = await params;

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

  const dataset = await getDataset(supabase, datasetId);
  if (!dataset || dataset.project_id !== projectId) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  // Real computed stats, no AI call — the raw `data` array is omitted
  // from the response (could be thousands of rows the client has no use
  // for once the summary is computed).
  const { data: _data, ...metadata } = dataset;
  const summary = summarizeDataset({ columns: dataset.column_schema, rows: dataset.data });
  return NextResponse.json({ dataset: metadata, summary });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; datasetId: string }> },
) {
  const { projectId, datasetId } = await params;

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

  const dataset = await getDataset(supabase, datasetId);
  if (!dataset || dataset.project_id !== projectId) {
    return NextResponse.json({ error: "Dataset not found" }, { status: 404 });
  }

  await deleteDataset(supabase, datasetId);
  return new NextResponse(null, { status: 204 });
}
