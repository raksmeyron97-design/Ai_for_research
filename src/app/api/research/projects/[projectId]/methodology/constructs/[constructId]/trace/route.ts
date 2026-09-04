import { NextResponse } from "next/server";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { loadMethodologyModel } from "@/lib/methodology/review-service";
import { listFrameworkNodes, listFrameworkRelationships } from "@/lib/db/framework";
import { listClaimMethodologyLinks } from "@/lib/db/integrity";
import { listClaims } from "@/lib/db/evidence";
import { traceConstruct } from "@/lib/methodology/construct-trace";

/**
 * What in this study depends on one construct (Phase 21 §25).
 *
 *   Construct → Indicators → Questionnaire items → Hypotheses
 *             → Framework relationships → Claims
 *
 * Assembled here rather than by the browser, for two reasons that are both
 * §32. The chain spans five tables, so building it client-side is five
 * requests and a join written in React; and the joins reduce hard — a
 * construct's trace is a handful of rows out of a project's entire
 * methodology, framework and claim set, so doing the work next to the data
 * sends a few hundred bytes instead of the project.
 *
 * Scoped per construct, not "trace everything": that is what keeps the
 * response bounded on a large project.
 *
 * The assembly itself is `traceConstruct`, which is pure and takes rows.
 * Nothing here infers a link — every relationship reported is a foreign key
 * somebody wrote down, and a missing one comes back in `gaps` rather than
 * being filled in (§25).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; constructId: string }> },
) {
  const { projectId, constructId } = await params;

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  const { supabase } = auth.auth;

  try {
    const [methodology, nodes, relationships, claims, claimLinks] = await Promise.all([
      loadMethodologyModel(supabase, projectId),
      listFrameworkNodes(supabase, projectId),
      listFrameworkRelationships(supabase, projectId),
      listClaims(supabase, projectId),
      listClaimMethodologyLinks(supabase, projectId),
    ]);

    const trace = traceConstruct(constructId, { methodology, nodes, relationships, claims, claimLinks });

    // Same answer for "not yours" and "does not exist": every query above is
    // project-scoped and RLS-bound, so a construct from another project is
    // simply absent from the model, and a probe learns nothing from the 404.
    if (!trace) {
      return NextResponse.json({ error: "That construct was not found." }, { status: 404 });
    }

    return NextResponse.json({ trace });
  } catch {
    return dbErrorResponse("Tracing that concept");
  }
}
