import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { getClaim } from "@/lib/db/evidence";
import { linkClaimToMethodology, listClaimMethodologyLinks, unlinkClaimMethodology } from "@/lib/db/integrity";

/**
 * Links a manuscript claim to the single Phase 18 methodology node it is
 * about (§6). The claim id comes from the path and is re-resolved inside
 * this project before anything is written — a claim id from another project
 * resolves to nothing here (§27), and the target id is checked by the
 * composite foreign key on the way in.
 */
const linkSchema = z
  .object({
    constructId: z.string().uuid().optional(),
    hypothesisId: z.string().uuid().optional(),
    indicatorId: z.string().uuid().optional(),
    objectiveId: z.string().uuid().optional(),
    questionId: z.string().uuid().optional(),
    note: z.string().trim().max(2000).optional(),
  })
  .refine(
    (data) =>
      [data.constructId, data.hypothesisId, data.indicatorId, data.objectiveId, data.questionId].filter(Boolean)
        .length === 1,
    { message: "Exactly one of constructId, hypothesisId, indicatorId, objectiveId, questionId must be given." },
  );

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; claimId: string }> },
) {
  const { projectId, claimId } = await params;
  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const links = await listClaimMethodologyLinks(auth.auth.supabase, projectId, claimId);
    return NextResponse.json({ links });
  } catch {
    return dbErrorResponse("Listing this claim's methodology links");
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; claimId: string }> },
) {
  const { projectId, claimId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const claim = await getClaim(auth.auth.supabase, projectId, claimId);
    if (!claim) return NextResponse.json({ error: "That claim was not found." }, { status: 404 });

    const link = await linkClaimToMethodology(auth.auth.supabase, {
      project_id: projectId,
      claim_id: claimId,
      construct_id: parsed.data.constructId ?? null,
      hypothesis_id: parsed.data.hypothesisId ?? null,
      indicator_id: parsed.data.indicatorId ?? null,
      objective_id: parsed.data.objectiveId ?? null,
      question_id: parsed.data.questionId ?? null,
      note: parsed.data.note ?? null,
    });

    return NextResponse.json({ link }, { status: 201 });
  } catch {
    return dbErrorResponse("Linking this claim to the methodology model");
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ projectId: string; claimId: string }> },
) {
  const { projectId } = await params;
  const linkId = new URL(req.url).searchParams.get("linkId");
  if (!linkId) return NextResponse.json({ error: "linkId is required" }, { status: 400 });

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    await unlinkClaimMethodology(auth.auth.supabase, projectId, linkId);
    return NextResponse.json({ ok: true });
  } catch {
    return dbErrorResponse("Removing that methodology link");
  }
}
