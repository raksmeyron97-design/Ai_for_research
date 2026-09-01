import { NextResponse } from "next/server";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { sectionTypeSchema } from "@/lib/db/project-schema";
import { buildSectionReview } from "@/lib/evidence/section-review-service";

/**
 * One section's health (§3-§5).
 *
 * No AI call: every number comes from `section-review.ts` counting rows and
 * words, which is why the panel can show an explanation beside each one. A
 * model's opinion would be cheaper to build and impossible to justify to a
 * supervisor.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; sectionType: string }> },
) {
  const { projectId, sectionType } = await params;

  const parsedType = sectionTypeSchema.safeParse(sectionType);
  if (!parsedType.success) return NextResponse.json({ error: "Unknown section type" }, { status: 400 });

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const review = await buildSectionReview(auth.auth.supabase, projectId, parsedType.data);
    return NextResponse.json({ review });
  } catch {
    return dbErrorResponse("The section check");
  }
}
