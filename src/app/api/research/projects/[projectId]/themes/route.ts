import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { createTheme, listThemeSources, listThemes } from "@/lib/db/themes";

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).optional(),
  /**
   * Set when the researcher is confirming a suggestion, so provenance survives
   * (§22). It cannot be used to create an *unconfirmed* theme: a row only
   * exists once the researcher has accepted it.
   */
  aiSuggested: z.boolean().optional(),
  citationIds: z.array(z.string().uuid()).max(200).optional(),
});

/** Themes and their assignments in one response — the tree is useless without the edges. */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const [themes, assignments] = await Promise.all([
      listThemes(auth.auth.supabase, projectId),
      listThemeSources(auth.auth.supabase, projectId),
    ]);
    return NextResponse.json({ themes, assignments });
  } catch {
    return dbErrorResponse("Loading themes");
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const theme = await createTheme(auth.auth.supabase, {
      project_id: projectId,
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      ai_suggested: parsed.data.aiSuggested ?? false,
      confirmed: true,
    });

    // Assignments are written one by one through the same composite-keyed
    // table, so a citation from another project fails on the foreign key
    // rather than being filtered out here and silently ignored.
    const assigned: string[] = [];
    for (const citationId of parsed.data.citationIds ?? []) {
      try {
        const { assignSourceToTheme } = await import("@/lib/db/themes");
        await assignSourceToTheme(auth.auth.supabase, {
          project_id: projectId,
          theme_id: theme.id,
          citation_id: citationId,
          ai_suggested: parsed.data.aiSuggested ?? false,
        });
        assigned.push(citationId);
      } catch {
        // One rejected source must not lose the theme the researcher just
        // named. The response says which were assigned.
      }
    }

    return NextResponse.json({ theme, assigned }, { status: 201 });
  } catch {
    return dbErrorResponse("Creating that theme");
  }
}
