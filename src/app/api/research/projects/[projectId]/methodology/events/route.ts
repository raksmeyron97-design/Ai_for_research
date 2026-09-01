import { NextResponse } from "next/server";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { listMethodologyEvents } from "@/lib/db/methodology-events";

/** Paged newest-first; there is no POST, because the log is written by the
 *  mutations themselves and a client-writable audit log is not an audit log. */
export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const before = url.searchParams.get("before") ?? undefined;
  const entityId = url.searchParams.get("entityId") ?? undefined;
  const limitParam = Number(url.searchParams.get("limit"));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 200) : 50;

  try {
    const events = await listMethodologyEvents(auth.auth.supabase, projectId, { limit, before, entityId });
    return NextResponse.json({ events, nextBefore: events.at(-1)?.created_at ?? null });
  } catch {
    return dbErrorResponse("Loading the methodology history");
  }
}
