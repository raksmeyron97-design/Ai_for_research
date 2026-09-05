import { NextResponse } from "next/server";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { listEvidence } from "@/lib/db/evidence";
import { sectionTypeSchema } from "@/lib/db/project-schema";
import { explainSectionCitations } from "@/lib/evidence/insertion";

/**
 * Saved evidence for a project, or — with `?sectionType=` — the resolved
 * Section → Claim → Evidence → Source → Citation chain for one section (§18).
 *
 * The section form is the one the Quality Checker will need, and is what
 * answers "why does this citation appear here?" without re-running a search.
 */
export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  const raw = new URL(req.url).searchParams.get("sectionType");
  if (raw) {
    const section = sectionTypeSchema.safeParse(raw);
    if (!section.success) return NextResponse.json({ error: "Unknown section type" }, { status: 400 });
    try {
      const provenance = await explainSectionCitations(auth.auth.supabase, projectId, section.data);
      return NextResponse.json({ provenance });
    } catch {
      return dbErrorResponse("Loading the evidence for this section");
    }
  }

  try {
    return NextResponse.json({ evidence: await listEvidence(auth.auth.supabase, projectId) });
  } catch {
    return dbErrorResponse("Loading evidence");
  }
}
