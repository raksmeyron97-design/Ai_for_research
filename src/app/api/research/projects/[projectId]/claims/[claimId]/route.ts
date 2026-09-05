import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { deleteClaim, getClaim, updateClaim } from "@/lib/db/evidence";

const patchSchema = z.object({
  text: z.string().trim().min(1).max(2000).optional(),
  type: z
    .enum(["factual", "statistical", "clinical", "comparative", "interpretive", "user_provided", "inference"])
    .optional(),
});

/**
 * Editing a claim before evidence is searched for it (§11).
 *
 * The claim is re-resolved inside the project before anything is written: a
 * claim id from another project must not be editable just because it was sent
 * to a project route the caller does own (§34).
 */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; claimId: string }> },
) {
  const { projectId, claimId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success || (!parsed.data.text && !parsed.data.type)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const existing = await getClaim(auth.auth.supabase, projectId, claimId);
    if (!existing) return NextResponse.json({ error: "That claim no longer exists." }, { status: 404 });

    const claim = await updateClaim(auth.auth.supabase, projectId, claimId, {
      claim_text: parsed.data.text,
      claim_type: parsed.data.type,
    });
    return NextResponse.json({ claim });
  } catch {
    return dbErrorResponse("Updating that claim");
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; claimId: string }> },
) {
  const { projectId, claimId } = await params;

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const existing = await getClaim(auth.auth.supabase, projectId, claimId);
    if (!existing) return NextResponse.json({ error: "That claim no longer exists." }, { status: 404 });

    await deleteClaim(auth.auth.supabase, projectId, claimId);
    return NextResponse.json({ deleted: true });
  } catch {
    return dbErrorResponse("Deleting that claim");
  }
}
