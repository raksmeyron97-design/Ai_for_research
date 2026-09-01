import { NextResponse } from "next/server";
import { DbError } from "@/lib/db/errors";
import { sectionTypeSchema, upsertSectionSchema } from "@/lib/db/project-schema";
import { getProject } from "@/lib/db/projects";
import { getSection, upsertSection } from "@/lib/db/sections";
import { recordSectionVersion } from "@/lib/db/section-versions";
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

  // Read before write: the previous content is the half of a version record
  // that cannot be reconstructed afterwards.
  const existing = await getSection(supabase, projectId, parsedType.data);
  const { change, ...sectionUpdate } = parsedBody.data;

  try {
    const section = await upsertSection(supabase, {
      project_id: projectId,
      section_type: parsedType.data,
      ...sectionUpdate,
    });

    // Only record when the text actually changed. A status-only save, or an
    // autosave that fires with identical content, is not a version — a
    // history padded with no-ops is harder to read than no history.
    const previous = existing?.content ?? "";
    if (sectionUpdate.content !== undefined && sectionUpdate.content !== previous) {
      try {
        await recordSectionVersion(supabase, {
          project_id: projectId,
          section_id: section.id,
          section_type: parsedType.data,
          previous_content: previous,
          new_content: sectionUpdate.content,
          action: change?.action ?? "manual",
          provider: change?.provider ?? null,
          model: change?.model ?? null,
          section_action: change?.sectionAction ?? null,
          created_by: userId,
        });
      } catch {
        // Losing a history entry must not fail the save the researcher is
        // waiting on. The content is already persisted at this point.
      }
    }

    return NextResponse.json({ section });
  } catch (err) {
    return NextResponse.json({ error: (err as DbError).message }, { status: 500 });
  }
}
