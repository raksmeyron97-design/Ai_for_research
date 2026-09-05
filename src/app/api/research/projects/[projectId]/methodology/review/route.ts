import { NextResponse } from "next/server";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { buildMethodologyReview } from "@/lib/methodology/review-service";

/**
 * Runs the deterministic review (§13-§15).
 *
 * A GET because it changes nothing: the findings are computed from the stored
 * rows every time. There is no rate limit because no provider is involved —
 * this is the half of Phase 18 that never contacts a model, which is also why
 * its result can be trusted as a statement about the project rather than about
 * a model's reading of it.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json({ review: await buildMethodologyReview(auth.auth.supabase, projectId) });
  } catch {
    return dbErrorResponse("Running the methodology review");
  }
}
