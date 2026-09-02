import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { mergeCitations, ReferenceMergeError } from "@/lib/integrity/reference-merge";

/**
 * The one action that actually merges two references (§21/§31). Always a
 * researcher's own request — nothing in this codebase calls this route from
 * an AI proposal path, and a suggested duplicate (§13) is only ever a
 * candidate the researcher chooses to act on here.
 */
const mergeSchema = z.object({
  primaryId: z.string().uuid(),
  duplicateId: z.string().uuid(),
});

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = mergeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const merged = await mergeCitations(auth.auth.supabase, projectId, parsed.data.primaryId, parsed.data.duplicateId);
    return NextResponse.json({ merged });
  } catch (error) {
    if (error instanceof ReferenceMergeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return dbErrorResponse("Merging those references");
  }
}
