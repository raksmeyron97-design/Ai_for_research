import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject } from "@/lib/api/authorize";
import { listChunksForDocuments } from "@/lib/db/chunks";
import { listDocuments } from "@/lib/db/documents";
import {
  compareSources,
  extractSourceProfile,
  MAX_COMPARE_SOURCES,
  MIN_COMPARE_SOURCES,
} from "@/lib/evidence/comparison";

const bodySchema = z.object({
  citationIds: z.array(z.string().uuid()).min(MIN_COMPARE_SOURCES).max(MAX_COMPARE_SOURCES),
  /** Extract a profile for any selected source that has none yet. */
  extractMissing: z.boolean().optional(),
  withNotes: z.boolean().optional(),
});

/** Number of excerpts per source sent to profile extraction. §36: few, not all. */
const EXCERPTS_PER_SOURCE = 4;

/**
 * The comparison matrix (§20-§21).
 *
 * Extraction is opt-in per request rather than automatic: a comparison of five
 * unprofiled sources would otherwise fire five model calls the researcher did
 * not ask for. The unprofiled ids come back either way, so the UI can offer it.
 */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Select between ${MIN_COMPARE_SOURCES} and ${MAX_COMPARE_SOURCES} sources to compare.` },
      { status: 400 },
    );
  }

  const auth = await authorizeProject(projectId, parsed.data.extractMissing ? { rateLimit: "ai" } : {});
  if (!auth.ok) return auth.response;

  const { supabase } = auth.auth;

  try {
    if (parsed.data.extractMissing) {
      const first = await compareSources(supabase, {
        projectId,
        citationIds: parsed.data.citationIds,
        userId: auth.auth.userId,
        withNotes: false,
      });

      if (first.unprofiledCitationIds.length > 0) {
        const documents = await listDocuments(supabase, projectId);
        for (const citationId of first.unprofiledCitationIds) {
          const docs = documents.filter((d) => d.citation_id === citationId);
          if (docs.length === 0) continue;
          const chunks = await listChunksForDocuments(
            supabase,
            projectId,
            docs.map((d) => d.id),
            EXCERPTS_PER_SOURCE,
          );
          if (chunks.length === 0) continue;
          try {
            await extractSourceProfile(supabase, {
              projectId,
              citationId,
              excerpts: chunks.map((c) => c.content),
              topic: auth.auth.project.title,
              userId: auth.auth.userId,
            });
          } catch {
            // A source that cannot be profiled stays unprofiled and is shown
            // as such. It must not fail the comparison of the others.
          }
        }
      }
    }

    const comparison = await compareSources(supabase, {
      projectId,
      citationIds: parsed.data.citationIds,
      userId: auth.auth.userId,
      withNotes: parsed.data.withNotes,
    });
    return NextResponse.json({ comparison });
  } catch {
    return NextResponse.json(
      { error: "The comparison could not be built. Nothing was changed — you can retry." },
      { status: 500 },
    );
  }
}
