import { NextResponse } from "next/server";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { sectionTypeSchema } from "@/lib/db/project-schema";
import { buildResearchIntegrityReview } from "@/lib/integrity/review-service";

/**
 * Runs the deterministic research-integrity review (§15, §35).
 *
 * A GET because it changes nothing — every finding and metric is recomputed
 * from stored rows on every call, the same discipline `SectionReview` and
 * `MethodologyReview` already follow. No rate limit: no provider is involved,
 * which is what lets this result be trusted as a statement about the project
 * rather than about a model's reading of it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  const sectionParam = new URL(req.url).searchParams.get("section");
  const parsedSection = sectionParam ? sectionTypeSchema.safeParse(sectionParam) : null;
  if (sectionParam && !parsedSection?.success) {
    return NextResponse.json({ error: "Invalid section" }, { status: 400 });
  }

  try {
    const review = await buildResearchIntegrityReview(auth.auth.supabase, projectId, {
      sectionType: parsedSection?.success ? parsedSection.data : undefined,
    });
    return NextResponse.json({ review });
  } catch {
    return dbErrorResponse("Running the research integrity review");
  }
}
