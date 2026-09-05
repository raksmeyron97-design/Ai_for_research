import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { listFrameworkNodes, reorderFrameworkNodes } from "@/lib/db/framework";
import { recordMethodologyEvent } from "@/lib/db/methodology-events";
import { recordEvent } from "@/lib/observability/events";

/**
 * Reorder the whole framework (Phase 21 §13, §36, §50).
 *
 * A PUT over the complete order rather than a PATCH per node. Moving one
 * concept up a list of seven is one researcher action; as seven requests it is
 * seven transactions that can half-apply, seven audit entries for one
 * decision, and a race between two tabs that lands on an order neither asked
 * for. `reorder_framework_nodes` applies the whole thing in one statement, so
 * the framework is never in an order nobody chose.
 *
 * PUT, not PATCH: the body is the entire order, and sending a subset is an
 * error rather than a partial reorder. The database enforces that too — it
 * refuses an array that does not name every node in the project exactly once.
 *
 * No `constructId`, no `label`, no relationship touched. §15: this is
 * presentation data, and a reorder must not be able to change what the study
 * claims.
 */
const bodySchema = z.object({
  // Bounded: the cap is far above any real framework and exists so a
  // malformed or hostile body cannot turn into an unbounded array parameter.
  nodeIds: z.array(z.string().uuid()).min(1).max(500),
});

export async function PUT(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  const started = Date.now();
  let nodes;
  try {
    nodes = await reorderFrameworkNodes(auth.auth.supabase, projectId, parsed.data.nodeIds);
  } catch {
    // §33/§36: the operational event says the reorder was REFUSED. It is
    // emitted here, in the failure path, rather than optimistically before
    // the call — an event claiming a mutation that did not happen is worse
    // than no event.
    recordEvent({
      name: "framework_reordered",
      projectId,
      status: "denied",
      errorClass: "validation",
      count: parsed.data.nodeIds.length,
      durationMs: Date.now() - started,
    });
    // The function raises invalid_parameter_value for a duplicate id, a
    // partial order, or an id from another project. All three are the caller
    // sending an order that does not describe this framework, which is a 400
    // — and all three get the same text, so a probe cannot use the error to
    // learn whether some id exists in a project it cannot see.
    return NextResponse.json(
      {
        error:
          "That ordering does not match this framework. Reload the framework and try again — " +
          "it may have changed in another tab.",
      },
      { status: 400 },
    );
  }

  recordEvent({
    name: "framework_reordered",
    projectId,
    status: "ok",
    count: parsed.data.nodeIds.length,
    durationMs: Date.now() - started,
  });

  // One audit entry for one action, after the reorder has actually committed
  // (§36). The audit trail is the researcher's record of their own decisions
  // and is append-only; the operational event above is for whoever runs the
  // service. They are different readers, so they are different logs.
  // Best-effort like every other audit write: the change is real, and
  // `audited: false` says the history entry is missing rather than letting the
  // caller assume one exists.
  let audited = true;
  try {
    await recordMethodologyEvent(auth.auth.supabase, {
      project_id: projectId,
      entity_type: "framework",
      // The reorder is a property of the framework, not of any one node, so
      // there is no single entity_id that honestly names it.
      entity_id: null,
      action: "updated",
      summary: `Reordered the conceptual framework (${parsed.data.nodeIds.length} concepts)`,
      new_value: { node_order: parsed.data.nodeIds },
    });
  } catch {
    audited = false;
  }

  try {
    // Return the list the way the workspace reads it, so the client renders
    // the committed order rather than the one it optimistically guessed.
    return NextResponse.json({
      nodes: nodes.length > 0 ? nodes : await listFrameworkNodes(auth.auth.supabase, projectId),
      audited,
    });
  } catch {
    return dbErrorResponse("Reordering the framework");
  }
}
