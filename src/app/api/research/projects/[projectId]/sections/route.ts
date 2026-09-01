import { NextResponse } from "next/server";
import { DbError } from "@/lib/db/errors";
import { getProject } from "@/lib/db/projects";
import { listSections } from "@/lib/db/sections";
import { createClient, requireUserId } from "@/lib/supabase/server";

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

  try {
    const sections = await listSections(supabase, projectId);
    return NextResponse.json({ sections });
  } catch (err) {
    return NextResponse.json({ error: (err as DbError).message }, { status: 500 });
  }
}
