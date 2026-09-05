import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject } from "@/lib/api/authorize";
import { sectionTypeSchema } from "@/lib/db/project-schema";
import { ClaimExtractionError, extractClaims } from "@/lib/evidence/claim-extraction";

const bodySchema = z.object({
  sectionType: sectionTypeSchema,
  passage: z.string().trim().min(1).max(20_000),
  passageOffset: z.number().int().min(0).optional(),
});

/**
 * Extracts claim candidates from a selected passage (§11).
 *
 * Nothing is written. The response is a proposal the researcher edits and then
 * saves through POST /claims — so a bad extraction costs a click, not a
 * cleanup.
 */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await authorizeProject(projectId, { rateLimit: "ai" });
  if (!auth.ok) return auth.response;

  try {
    const claims = await extractClaims(auth.auth.supabase, {
      projectId,
      section: parsed.data.sectionType,
      passage: parsed.data.passage,
      passageOffset: parsed.data.passageOffset,
      userId: auth.auth.userId,
    });
    return NextResponse.json({ claims });
  } catch (err) {
    if (err instanceof ClaimExtractionError) {
      return NextResponse.json({ error: err.userMessage, contentSaved: false }, { status: 422 });
    }
    return NextResponse.json(
      { error: "Claim extraction could not be completed. Nothing was saved.", contentSaved: false },
      { status: 500 },
    );
  }
}
