import { NextResponse } from "next/server";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { unlinkHypothesisVariable } from "@/lib/db/methodology";
import { recordMethodologyEvent } from "@/lib/db/methodology-events";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; linkId: string }> },
) {
  const { projectId, linkId } = await params;

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    await unlinkHypothesisVariable(auth.auth.supabase, projectId, linkId);
    await recordMethodologyEvent(auth.auth.supabase, {
      project_id: projectId,
      entity_type: "hypothesis_variable",
      entity_id: linkId,
      action: "unmapped",
      summary: "Removed a construct from a hypothesis",
    }).catch(() => undefined);
    return new NextResponse(null, { status: 204 });
  } catch {
    return dbErrorResponse("Removing that link");
  }
}
