import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { DbError } from "@/lib/db/errors";
import { sectionTypeSchema } from "@/lib/db/project-schema";
import { getSection } from "@/lib/db/sections";
import { listSectionVersions, restoreSectionVersion } from "@/lib/db/section-versions";

const restoreSchema = z.object({
  versionId: z.string().uuid(),
});

/** History for one section, newest first and bounded (§6). */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ projectId: string; sectionType: string }> },
) {
  const { projectId, sectionType } = await params;

  const parsedType = sectionTypeSchema.safeParse(sectionType);
  if (!parsedType.success) return NextResponse.json({ error: "Unknown section type" }, { status: 400 });

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  const limit = Math.min(Number(new URL(req.url).searchParams.get("limit") ?? 25) || 25, 100);

  try {
    const section = await getSection(auth.auth.supabase, projectId, parsedType.data);
    // A section that has never been saved has no history — and no id to query
    // by. An empty list is the honest answer, not a 404.
    if (!section) return NextResponse.json({ versions: [] });

    const versions = await listSectionVersions(auth.auth.supabase, section.id, limit);
    return NextResponse.json({ versions });
  } catch {
    return dbErrorResponse("Loading the version history");
  }
}

/**
 * Restore (§7-§8).
 *
 * `restoreSectionVersion` writes the section and appends a new version
 * pointing at the one it came from. Nothing between the restore point and now
 * is deleted, so a researcher who restores an old draft and changes their mind
 * still has every version they had before.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; sectionType: string }> },
) {
  const { projectId, sectionType } = await params;

  const parsedType = sectionTypeSchema.safeParse(sectionType);
  if (!parsedType.success) return NextResponse.json({ error: "Unknown section type" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = restoreSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  const { supabase, userId } = auth.auth;

  try {
    const section = await getSection(supabase, projectId, parsedType.data);
    if (!section) return NextResponse.json({ error: "That section has no saved history yet." }, { status: 404 });

    const { section: saved, version } = await restoreSectionVersion(supabase, {
      projectId,
      sectionId: section.id,
      sectionType: parsedType.data,
      versionId: parsed.data.versionId,
      currentContent: section.content,
      status: section.status,
      metadata: section.metadata,
      userId,
    });

    return NextResponse.json({ section: saved, version });
  } catch (err) {
    if (err instanceof DbError && err.notFound) {
      return NextResponse.json({ error: "That version no longer exists." }, { status: 404 });
    }
    return dbErrorResponse("Restoring that version");
  }
}
