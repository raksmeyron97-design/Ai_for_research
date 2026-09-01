import { NextResponse } from "next/server";
import { DbError } from "@/lib/db/errors";
import { updateProjectSchema } from "@/lib/db/project-schema";
import { deleteProject, getProject, getProjectProgress, updateProject } from "@/lib/db/projects";
import { createClient, requireUserId } from "@/lib/supabase/server";

async function requireAuth() {
  try {
    return { userId: await requireUserId(), unavailable: false as const };
  } catch {
    return { userId: null, unavailable: true as const };
  }
}

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { userId, unavailable } = await requireAuth();
  if (unavailable) return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const project = await getProject(supabase, projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const progress = await getProjectProgress(supabase, projectId);
  return NextResponse.json({ project: { ...project, progress } });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { userId, unavailable } = await requireAuth();
  if (unavailable) return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const existing = await getProject(supabase, projectId);
  if (!existing) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const parsed = updateProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid update", details: parsed.error.flatten() }, { status: 400 });
  }

  try {
    const project = await updateProject(supabase, projectId, parsed.data);
    return NextResponse.json({ project });
  } catch (err) {
    return NextResponse.json({ error: (err as DbError).message }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { userId, unavailable } = await requireAuth();
  if (unavailable) return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const existing = await getProject(supabase, projectId);
  if (!existing) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    await deleteProject(supabase, projectId);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return NextResponse.json({ error: (err as DbError).message }, { status: 500 });
  }
}
