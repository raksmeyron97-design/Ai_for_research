import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { deleteTheme, renameTheme } from "@/lib/db/themes";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; themeId: string }> },
) {
  const { projectId, themeId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const theme = await renameTheme(auth.auth.supabase, projectId, themeId, parsed.data);
    return NextResponse.json({ theme });
  } catch {
    return dbErrorResponse("Renaming that theme");
  }
}

/** Deletes the theme and its assignments. The sources themselves are untouched. */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; themeId: string }> },
) {
  const { projectId, themeId } = await params;

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    await deleteTheme(auth.auth.supabase, projectId, themeId);
    return NextResponse.json({ deleted: true });
  } catch {
    return dbErrorResponse("Deleting that theme");
  }
}
