import { NextResponse } from "next/server";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { buildSourceConflicts } from "@/lib/integrity/conflicts";
import { loadIntegrityModel } from "@/lib/integrity/review-service";

/**
 * Every claim with disagreeing sources, project-wide (§7/§26). Computed from
 * the same rows `buildResearchIntegrityReview` loads — nothing new is stored,
 * and a claim with only agreeing sources (or none at all) is simply absent
 * from the list rather than included with `hasConflict: false`.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const model = await loadIntegrityModel(auth.auth.supabase, projectId);
    const claimIds = new Set(model.claimEvidence.map((ce) => ce.claim_id));

    const conflicts = [...claimIds]
      .map((claimId) => buildSourceConflicts(claimId, model.claimEvidence, model.evidence, model.citations))
      .filter((c) => c.hasConflict);

    return NextResponse.json({ conflicts });
  } catch {
    return dbErrorResponse("Finding source conflicts");
  }
}
