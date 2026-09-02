import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { recordIntegrityEvent, upsertIntegrityDecision } from "@/lib/db/integrity";

/**
 * Records a researcher's disposition of one derived finding (§26).
 *
 * There is no "AI dismiss" path anywhere in this codebase — only a
 * researcher action reaches this route, and every call also writes an
 * append-only event, so "what was flagged and what did I do about it"
 * stays reconstructable even though the finding itself is never stored.
 */
const decisionSchema = z.object({
  findingId: z.string().trim().min(1).max(300),
  status: z.enum(["open", "reviewing", "accepted", "dismissed", "resolved_manually"]),
  note: z.string().trim().max(2000).optional(),
});

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = decisionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const decision = await upsertIntegrityDecision(auth.auth.supabase, projectId, parsed.data.findingId, {
      status: parsed.data.status,
      note: parsed.data.note ?? null,
      actor_id: auth.auth.userId,
    });

    await recordIntegrityEvent(auth.auth.supabase, {
      project_id: projectId,
      entity_type: "finding",
      entity_id: null,
      action: parsed.data.status === "dismissed" ? "finding_dismissed" : "finding_reviewed",
      summary: `Marked finding "${parsed.data.findingId}" as ${parsed.data.status}`,
      new_value: { findingId: parsed.data.findingId, status: parsed.data.status, note: parsed.data.note ?? null },
    }).catch(() => undefined);

    return NextResponse.json({ decision }, { status: 201 });
  } catch {
    return dbErrorResponse("Recording that decision");
  }
}
