import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { assignSourceToTheme, removeSourceFromTheme } from "@/lib/db/themes";

const bodySchema = z.object({ citationId: z.string().uuid() });

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; themeId: string }> },
) {
  const { projectId, themeId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const assignment = await assignSourceToTheme(auth.auth.supabase, {
      project_id: projectId,
      theme_id: themeId,
      citation_id: parsed.data.citationId,
    });
    return NextResponse.json({ assignment }, { status: 201 });
  } catch {
    // Covers both "already assigned" and a source/theme outside this project;
    // the composite foreign keys make the second impossible to write.
    return NextResponse.json(
      { error: "That source could not be added to this theme." },
      { status: 409 },
    );
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; themeId: string }> },
) {
  const { projectId, themeId } = await params;

  const citationId = new URL(req.url).searchParams.get("citationId");
  if (!citationId) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    await removeSourceFromTheme(auth.auth.supabase, projectId, themeId, citationId);
    return NextResponse.json({ removed: true });
  } catch {
    return dbErrorResponse("Removing that source");
  }
}
