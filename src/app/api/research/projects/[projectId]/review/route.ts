import { NextResponse } from "next/server";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { buildResearchSystemReview } from "@/lib/review/review-service";

/**
 * The cross-system review (§20/§21).
 *
 * GET, and recomputed every time. There is no POST because running a review
 * changes nothing — findings are derived from the stored rows, and §21 is
 * explicit that they must not become state of their own.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json({ review: await buildResearchSystemReview(auth.auth.supabase, projectId) });
  } catch {
    return dbErrorResponse("Running the research review");
  }
}
