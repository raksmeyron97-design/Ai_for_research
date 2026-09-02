import { NextResponse } from "next/server";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { listCitations } from "@/lib/db/citations";
import { findDuplicateReferences } from "@/lib/integrity/reference-audit";

/**
 * Deterministic duplicate candidates only (§21) — identifier equality or an
 * exact normalized title+year+first-author match. Nothing here merges
 * anything; see `references/merge` for the one action that does, and even
 * that is always a researcher's own request.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const citations = await listCitations(auth.auth.supabase, projectId);
    return NextResponse.json({ duplicates: findDuplicateReferences(citations) });
  } catch {
    return dbErrorResponse("Finding duplicate references");
  }
}
