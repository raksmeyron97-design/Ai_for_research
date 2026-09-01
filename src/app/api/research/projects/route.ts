import { NextResponse } from "next/server";
import { DbError } from "@/lib/db/errors";
import { createProjectSchema } from "@/lib/db/project-schema";
import { createProject, getProjectProgress, listProjects } from "@/lib/db/projects";
import { createClient, requireUserId } from "@/lib/supabase/server";

export async function GET() {
  let userId: string | null;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  try {
    const projects = await listProjects(supabase);
    const withProgress = await Promise.all(
      projects.map(async (project) => ({
        ...project,
        progress: await getProjectProgress(supabase, project.id),
      })),
    );
    return NextResponse.json({ projects: withProgress });
  } catch (err) {
    return NextResponse.json({ error: (err as DbError).message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  let userId: string | null;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid project", details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  try {
    const project = await createProject(supabase, userId, parsed.data);
    return NextResponse.json({ project }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as DbError).message }, { status: 500 });
  }
}
