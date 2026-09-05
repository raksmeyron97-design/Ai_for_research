import { NextResponse } from "next/server";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { loadMethodologyModel } from "@/lib/methodology/review-service";

/**
 * The whole methodology model in one response.
 *
 * One request rather than eight, because the workspace needs the edges as much
 * as the nodes: a construct list without its indicators cannot render coverage,
 * and eight round trips would render eight loading states for one screen.
 *
 * It stays bounded — this is the methodology model, not the project. No section
 * prose beyond the analysis plan, no sources, no evidence, no history.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json({ model: await loadMethodologyModel(auth.auth.supabase, projectId) });
  } catch {
    return dbErrorResponse("Loading the methodology model");
  }
}
