import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject } from "@/lib/api/authorize";
import { getClaim } from "@/lib/db/evidence";
import { getSection } from "@/lib/db/sections";
import { searchEvidenceForClaim } from "@/lib/evidence/evidence-search";

const bodySchema = z.object({
  /** A short window around the claim. Capped, because §36 asks for the smallest useful context. */
  nearbyContext: z.string().max(2000).optional(),
  documentIds: z.array(z.string().uuid()).max(20).optional(),
  topK: z.number().int().min(1).max(20).optional(),
});

/**
 * Evidence candidates for one claim (§13-§14).
 *
 * The claim is fetched by id *within the project*, and its own text is what
 * drives retrieval — the request cannot supply a different claim text, so a
 * caller cannot use this route to run an arbitrary search against another
 * researcher's index by pairing a real project id with invented text.
 *
 * Ranking is deterministic and happens server-side, so what the researcher
 * sees and what a test asserts are the same ordering.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; claimId: string }> },
) {
  const { projectId, claimId } = await params;

  const body = await req.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const auth = await authorizeProject(projectId, { rateLimit: "ai" });
  if (!auth.ok) return auth.response;

  const claim = await getClaim(auth.auth.supabase, projectId, claimId);
  if (!claim) return NextResponse.json({ error: "That claim no longer exists." }, { status: 404 });

  try {
    const section = await getSection(auth.auth.supabase, projectId, claim.section_type);
    const result = await searchEvidenceForClaim(auth.auth.supabase, {
      projectId,
      section: claim.section_type,
      claimText: claim.claim_text,
      nearbyContext: parsed.data.nearbyContext,
      sectionContent: section?.content,
      documentIds: parsed.data.documentIds,
      topK: parsed.data.topK,
    });

    if (result.outcome === "retrieval_failed") {
      return NextResponse.json(
        {
          outcome: result.outcome,
          candidates: [],
          error: "The evidence search could not run just now. Nothing was changed — try again.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({ outcome: result.outcome, candidates: result.candidates, claim });
  } catch {
    return NextResponse.json(
      { outcome: "retrieval_failed", candidates: [], error: "The evidence search could not be completed." },
      { status: 500 },
    );
  }
}
