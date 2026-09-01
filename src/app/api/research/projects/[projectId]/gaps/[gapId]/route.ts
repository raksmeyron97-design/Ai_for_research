import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { deleteGap, updateGap } from "@/lib/db/gaps";

const patchSchema = z.object({
  text: z.string().trim().min(1).max(2000).optional(),
  basis: z
    .enum(["source_stated", "derived_limitation", "ai_inference", "user_observation", "needs_verification"])
    .optional(),
  supportingText: z.string().trim().max(4000).nullable().optional(),
  /** The researcher confirming they checked it — the only way this becomes true (§24). */
  verified: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; gapId: string }> },
) {
  const { projectId, gapId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const gap = await updateGap(auth.auth.supabase, projectId, gapId, {
      gap_text: parsed.data.text,
      basis: parsed.data.basis,
      supporting_text: parsed.data.supportingText,
      verified: parsed.data.verified,
    });
    return NextResponse.json({ gap });
  } catch {
    return dbErrorResponse("Updating that gap");
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; gapId: string }> },
) {
  const { projectId, gapId } = await params;

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    await deleteGap(auth.auth.supabase, projectId, gapId);
    return NextResponse.json({ deleted: true });
  } catch {
    return dbErrorResponse("Deleting that gap");
  }
}
