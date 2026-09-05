import { NextResponse } from "next/server";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { buildResearchIntegrityReview } from "@/lib/integrity/review-service";

/**
 * The pre-export integrity gate (§37). Warns, never blocks by default — the
 * export route itself is untouched; the client calls this first and shows a
 * confirm-to-proceed dialog when `blocking` warnings exist. `blocking` is
 * always `false` here: nothing in the current product policy requires
 * refusing an export, so this only ever informs.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const review = await buildResearchIntegrityReview(auth.auth.supabase, projectId);
    const warnings = review.findings.filter((f) => f.severity !== "info").slice(0, 50);

    return NextResponse.json({
      blocking: false,
      summary: {
        claimsRequiringEvidence: review.coverage.citation.requiringEvidence,
        citationsCited: review.coverage.citation.cited,
        unresolvedOrMissingCitations: review.findings.filter((f) => f.category === "citation").length,
        methodologyMismatches: review.findings.filter((f) => f.category === "methodology").length,
        referenceIssues: review.findings.filter((f) => f.category === "reference").length,
      },
      warnings,
    });
  } catch {
    return dbErrorResponse("Checking research integrity before export");
  }
}
