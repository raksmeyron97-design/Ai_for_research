import { NextResponse } from "next/server";
import { deleteInstrument, getInstrument } from "@/lib/db/instruments";
import { getProject } from "@/lib/db/projects";
import { listQuestions } from "@/lib/db/questions";
import { createClient, requireUserId } from "@/lib/supabase/server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; instrumentId: string }> },
) {
  const { projectId, instrumentId } = await params;

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

  const instrument = await getInstrument(supabase, instrumentId);
  if (!instrument || instrument.project_id !== projectId) {
    return NextResponse.json({ error: "Instrument not found" }, { status: 404 });
  }

  const questions = await listQuestions(supabase, instrumentId);
  return NextResponse.json({ instrument, questions });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; instrumentId: string }> },
) {
  const { projectId, instrumentId } = await params;

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

  const instrument = await getInstrument(supabase, instrumentId);
  if (!instrument || instrument.project_id !== projectId) {
    return NextResponse.json({ error: "Instrument not found" }, { status: 404 });
  }

  await deleteInstrument(supabase, instrumentId);
  return new NextResponse(null, { status: 204 });
}
