import { NextResponse } from "next/server";
import { DbError } from "@/lib/db/errors";
import { sectionTypeSchema, upsertSectionSchema } from "@/lib/db/project-schema";
import { getProject } from "@/lib/db/projects";
import { getSection, upsertSection } from "@/lib/db/sections";
import { createClient, requireUserId } from "@/lib/supabase/server";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; sectionType: string }> },
) {
  const { projectId, sectionType } = await params;
  const parsedType = sectionTypeSchema.safeParse(sectionType);
  if (!parsedType.success) {
    return NextResponse.json({ error: "Unknown section type" }, { status: 400 });
  }

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

  const section = await getSection(supabase, projectId, parsedType.data);
  return NextResponse.json({ section });
}

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ projectId: string; sectionType: string }> },
) {
  const { projectId, sectionType } = await params;
  const parsedType = sectionTypeSchema.safeParse(sectionType);
  if (!parsedType.success) {
    return NextResponse.json({ error: "Unknown section type" }, { status: 400 });
  }

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

  const body = await req.json().catch(() => null);
  const parsedBody = upsertSectionSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ error: "Invalid section update", details: parsedBody.error.flatten() }, { status: 400 });
  }

  try {
    const section = await upsertSection(supabase, {
      project_id: projectId,
      section_type: parsedType.data,
      ...parsedBody.data,
    });
    return NextResponse.json({ section });
  } catch (err) {
    return NextResponse.json({ error: (err as DbError).message }, { status: 500 });
  }
}
