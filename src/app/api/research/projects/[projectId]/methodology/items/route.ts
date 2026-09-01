import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { getInstrument } from "@/lib/db/instruments";
import { insertQuestions, listQuestions } from "@/lib/db/questions";
import { recordMethodologyEvent } from "@/lib/db/methodology-events";

/**
 * Saves items the researcher accepted (§30).
 *
 * `itemProvenance` may be `ai_suggested` — that is how an accepted suggestion
 * keeps its provenance — but the route offers no way to record a source: there
 * is no `sourceCitationId` here, so a generated item cannot arrive already
 * attributed to a published instrument. Attribution is a separate, deliberate
 * edit through the item PATCH, which is where §31's pairing is enforced.
 */
const createSchema = z.object({
  instrumentId: z.string().uuid(),
  items: z
    .array(
      z.object({
        questionText: z.string().trim().min(1).max(2000),
        sectionLabel: z.string().trim().min(1).max(200),
        responseType: z.enum(["likert", "multiple_choice", "yes_no", "open_text", "numeric"]),
        options: z.array(z.string().max(200)).max(20).nullable().optional(),
        required: z.boolean().optional(),
        constructId: z.string().uuid().nullable().optional(),
        indicatorId: z.string().uuid().nullable().optional(),
        scaleId: z.string().uuid().nullable().optional(),
        reverseCoded: z.boolean().optional(),
        itemProvenance: z.enum(["user", "ai_suggested", "imported"]).optional(),
      }),
    )
    .min(1)
    .max(30),
});

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    // The instrument id is re-resolved inside the project rather than trusted,
    // so items cannot be appended to another researcher's questionnaire (§27).
    const instrument = await getInstrument(auth.auth.supabase, parsed.data.instrumentId);
    if (!instrument || instrument.project_id !== projectId) {
      return NextResponse.json({ error: "That questionnaire was not found." }, { status: 404 });
    }

    const existing = await listQuestions(auth.auth.supabase, instrument.id);
    let orderIndex = existing.length;

    const items = await insertQuestions(
      auth.auth.supabase,
      parsed.data.items.map((item) => ({
        instrument_id: instrument.id,
        project_id: projectId,
        section_label: item.sectionLabel,
        question_text: item.questionText,
        response_type: item.responseType,
        options: item.options ?? null,
        required: item.required ?? true,
        order_index: orderIndex++,
        construct_id: item.constructId ?? null,
        indicator_id: item.indicatorId ?? null,
        scale_id: item.scaleId ?? null,
        reverse_coded: item.reverseCoded ?? false,
        item_provenance: item.itemProvenance ?? "user",
      })),
    );

    for (const item of items) {
      await recordMethodologyEvent(auth.auth.supabase, {
        project_id: projectId,
        entity_type: "questionnaire_item",
        entity_id: item.id,
        action: "created",
        summary: `Added questionnaire item: ${item.question_text.slice(0, 100)}`,
        new_value: item as unknown as Record<string, unknown>,
      }).catch(() => undefined);
    }

    return NextResponse.json({ items }, { status: 201 });
  } catch {
    return dbErrorResponse("Saving those items");
  }
}
