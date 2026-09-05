import { NextResponse } from "next/server";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { getCitation } from "@/lib/db/citations";
import { listDocuments } from "@/lib/db/documents";
import { listEvidence } from "@/lib/db/evidence";
import { getSourceProfiles } from "@/lib/db/source-profiles";
import { listThemeSources, listThemes } from "@/lib/db/themes";
import type { ResearchClaimEvidenceRow, ResearchClaimRow } from "@/lib/db/types";

/**
 * Everything about one source (§26): its metadata, the documents it was
 * uploaded as, the excerpts saved from it, the claims those excerpts support,
 * the sections those claims live in, and its themes.
 *
 * Assembled in one response rather than left to the client, because the
 * interesting relationships here are joins — "which of my sections rest on
 * this paper" is four hops, and four client fetches to answer it is both
 * slower and easy to get subtly wrong in one place and not another.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ projectId: string; citationId: string }> },
) {
  const { projectId, citationId } = await params;

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  const { supabase } = auth.auth;

  const citation = await getCitation(supabase, citationId);
  // Re-checked against the project even though RLS scoped the read (§34).
  if (!citation || citation.project_id !== projectId) {
    return NextResponse.json({ error: "Source not found" }, { status: 404 });
  }

  try {
    const [allEvidence, documents, themes, assignments, profiles] = await Promise.all([
      listEvidence(supabase, projectId),
      listDocuments(supabase, projectId),
      listThemes(supabase, projectId),
      listThemeSources(supabase, projectId),
      getSourceProfiles(supabase, projectId, [citationId]),
    ]);

    const evidence = allEvidence.filter((e) => e.citation_id === citationId);

    let claims: ResearchClaimRow[] = [];
    let links: ResearchClaimEvidenceRow[] = [];
    if (evidence.length > 0) {
      const { data: linkRows } = await supabase
        .from("research_claim_evidence")
        .select("*")
        .eq("project_id", projectId)
        .in(
          "evidence_id",
          evidence.map((e) => e.id),
        );
      links = (linkRows ?? []) as ResearchClaimEvidenceRow[];

      if (links.length > 0) {
        const { data: claimRows } = await supabase
          .from("research_claims")
          .select("*")
          .eq("project_id", projectId)
          .in(
            "id",
            links.map((l) => l.claim_id),
          );
        claims = (claimRows ?? []) as ResearchClaimRow[];
      }
    }

    const themeIds = new Set(
      assignments.filter((a) => a.citation_id === citationId).map((a) => a.theme_id),
    );

    return NextResponse.json({
      citation,
      profile: profiles[0] ?? null,
      documents: documents.filter((d) => d.citation_id === citationId),
      evidence,
      claims,
      links,
      // Distinct sections this source is cited in, which is the answer to
      // "where does this paper appear in my thesis".
      sections: [...new Set(claims.map((c) => c.section_type))],
      themes: themes.filter((t) => themeIds.has(t.id)),
    });
  } catch {
    return dbErrorResponse("Loading that source");
  }
}
