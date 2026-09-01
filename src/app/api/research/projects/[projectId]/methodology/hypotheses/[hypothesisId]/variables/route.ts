import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { linkHypothesisVariable, listHypotheses } from "@/lib/db/methodology";
import { recordMethodologyEvent } from "@/lib/db/methodology-events";

const linkSchema = z.object({
  constructId: z.string().uuid(),
  position: z.enum(["predictor", "outcome", "mediator", "moderator", "control"]),
});

/**
 * Places a construct in a hypothesis (§8).
 *
 * The hypothesis id comes from the path and is re-resolved inside the project
 * before anything is written — a hypothesis id from another project resolves to
 * nothing here, and the construct id is checked by the composite foreign key on
 * the way in. Neither is trusted because it was supplied (§27).
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; hypothesisId: string }> },
) {
  const { projectId, hypothesisId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = linkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const hypothesis = (await listHypotheses(auth.auth.supabase, projectId)).find((h) => h.id === hypothesisId);
    if (!hypothesis) return NextResponse.json({ error: "That hypothesis was not found." }, { status: 404 });

    const link = await linkHypothesisVariable(auth.auth.supabase, {
      project_id: projectId,
      hypothesis_id: hypothesisId,
      construct_id: parsed.data.constructId,
      position: parsed.data.position,
    });

    await recordMethodologyEvent(auth.auth.supabase, {
      project_id: projectId,
      entity_type: "hypothesis_variable",
      entity_id: link.id,
      action: "mapped",
      summary: `Linked a construct as the ${parsed.data.position} of ${hypothesis.label ?? "a hypothesis"}`,
      new_value: link as unknown as Record<string, unknown>,
    }).catch(() => undefined);

    return NextResponse.json({ link }, { status: 201 });
  } catch {
    return dbErrorResponse("Linking that construct");
  }
}
