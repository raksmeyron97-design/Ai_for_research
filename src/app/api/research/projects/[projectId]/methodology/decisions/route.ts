import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { recordMethodologyEvent } from "@/lib/db/methodology-events";

/**
 * Records what the researcher did with a proposal (§16, §23).
 *
 * A rejection writes nothing else — there is no row to create — so without this
 * the history would only ever show accepted suggestions, and "the assistant
 * proposed five constructs and I kept one" would be indistinguishable from "the
 * assistant proposed one". The proposal itself is stored alongside the
 * decision, so what was offered is reconstructable after the fact.
 */
const decisionSchema = z.object({
  entityType: z.enum([
    "research_question", "objective", "construct", "indicator", "hypothesis",
    "hypothesis_variable", "scale", "questionnaire_item", "framework",
  ]),
  /** Set when accepting created a row; absent for a rejection. */
  entityId: z.string().uuid().nullable().optional(),
  accepted: z.boolean(),
  summary: z.string().trim().min(1).max(300),
  /** What the model proposed, verbatim, capped so the log cannot be used as storage. */
  proposal: z.record(z.string(), z.unknown()).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  if (JSON.stringify(parsed.data.proposal ?? {}).length > 8000) {
    return NextResponse.json({ error: "That proposal is too large to record." }, { status: 400 });
  }

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const event = await recordMethodologyEvent(auth.auth.supabase, {
      project_id: projectId,
      entity_type: parsed.data.entityType,
      entity_id: parsed.data.entityId ?? null,
      action: parsed.data.accepted ? "ai_suggestion_accepted" : "ai_suggestion_rejected",
      summary: parsed.data.summary,
      proposal: parsed.data.proposal ?? null,
    });
    return NextResponse.json({ event }, { status: 201 });
  } catch {
    return dbErrorResponse("Recording that decision");
  }
}
