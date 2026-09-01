import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { getQuestion, updateQuestion } from "@/lib/db/questions";
import { recordMethodologyEvent } from "@/lib/db/methodology-events";

/**
 * Edits a questionnaire item's methodology metadata (§22).
 *
 * This does not create a second questionnaire system — the item is the same
 * `questionnaire_questions` row the Phase 6 builder has always edited. What
 * this adds is the mapping, the scale and the provenance.
 *
 * `sourceCitationId` and `adaptationType` are accepted only from the
 * researcher, and only together: §31 requires an item claiming a source to name
 * one, and the database enforces the same pairing. No AI workflow can reach
 * this route's source fields, because no AI workflow returns a citation id.
 */
const patchSchema = z
  .object({
    questionText: z.string().trim().min(1).max(2000).optional(),
    sectionLabel: z.string().trim().min(1).max(200).optional(),
    responseType: z.enum(["likert", "multiple_choice", "yes_no", "open_text", "numeric"]).optional(),
    required: z.boolean().optional(),
    reverseCoded: z.boolean().optional(),
    constructId: z.string().uuid().nullable().optional(),
    indicatorId: z.string().uuid().nullable().optional(),
    scaleId: z.string().uuid().nullable().optional(),
    /** The researcher confirming an AI-suggested item as their own. */
    itemProvenance: z.enum(["user", "ai_suggested", "source_stated", "imported"]).optional(),
    sourceCitationId: z.string().uuid().nullable().optional(),
    sourceLocation: z.string().trim().max(200).nullable().optional(),
    adaptationType: z.enum(["verbatim", "adapted", "translated", "inspired_by"]).nullable().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "Nothing to update" })
  .refine((p) => !(p.adaptationType && p.sourceCitationId === null), {
    message: "An item cannot be marked as adapted from a source without naming the source.",
  });

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ projectId: string; itemId: string }> },
) {
  const { projectId, itemId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  const p = parsed.data;
  try {
    const previous = await getQuestion(auth.auth.supabase, projectId, itemId);
    if (!previous) return NextResponse.json({ error: "That item was not found." }, { status: 404 });

    const item = await updateQuestion(auth.auth.supabase, projectId, itemId, {
      ...(p.questionText !== undefined ? { question_text: p.questionText } : {}),
      ...(p.sectionLabel !== undefined ? { section_label: p.sectionLabel } : {}),
      ...(p.responseType !== undefined ? { response_type: p.responseType } : {}),
      ...(p.required !== undefined ? { required: p.required } : {}),
      ...(p.reverseCoded !== undefined ? { reverse_coded: p.reverseCoded } : {}),
      ...(p.constructId !== undefined ? { construct_id: p.constructId } : {}),
      ...(p.indicatorId !== undefined ? { indicator_id: p.indicatorId } : {}),
      ...(p.scaleId !== undefined ? { scale_id: p.scaleId } : {}),
      ...(p.itemProvenance !== undefined ? { item_provenance: p.itemProvenance } : {}),
      ...(p.sourceCitationId !== undefined ? { source_citation_id: p.sourceCitationId } : {}),
      ...(p.sourceLocation !== undefined ? { source_location: p.sourceLocation } : {}),
      ...(p.adaptationType !== undefined ? { adaptation_type: p.adaptationType } : {}),
    });

    const mappingChanged =
      p.constructId !== undefined || p.indicatorId !== undefined || p.scaleId !== undefined;

    await recordMethodologyEvent(auth.auth.supabase, {
      project_id: projectId,
      entity_type: "questionnaire_item",
      entity_id: item.id,
      action: mappingChanged ? "mapped" : "updated",
      summary: mappingChanged
        ? `Remapped questionnaire item: ${item.question_text.slice(0, 100)}`
        : `Edited questionnaire item: ${item.question_text.slice(0, 100)}`,
      previous_value: previous as unknown as Record<string, unknown>,
      new_value: item as unknown as Record<string, unknown>,
    }).catch(() => undefined);

    return NextResponse.json({ item });
  } catch {
    return dbErrorResponse("Updating that item");
  }
}
