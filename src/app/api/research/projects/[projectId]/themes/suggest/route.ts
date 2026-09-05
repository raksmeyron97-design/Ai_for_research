import { NextResponse } from "next/server";
import { authorizeProject } from "@/lib/api/authorize";
import { suggestThemes } from "@/lib/evidence/theme-suggestions";

/**
 * Proposes themes. Writes nothing (§22).
 *
 * The response is explicitly labelled so the UI cannot render a suggestion as
 * an existing theme by accident: every item carries `aiSuggested: true`, and a
 * theme row is only created when the researcher confirms one.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const auth = await authorizeProject(projectId, { rateLimit: "ai" });
  if (!auth.ok) return auth.response;

  try {
    const suggestions = await suggestThemes(auth.auth.supabase, {
      projectId,
      userId: auth.auth.userId,
    });
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json(
      { error: "Theme suggestions could not be generated. Nothing was saved." },
      { status: 502 },
    );
  }
}
