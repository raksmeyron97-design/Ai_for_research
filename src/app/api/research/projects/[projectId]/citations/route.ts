import { NextResponse } from "next/server";
import { z } from "zod";
import { listCitations, upsertCitation } from "@/lib/db/citations";
import { DbError } from "@/lib/db/errors";
import { getProject } from "@/lib/db/projects";
import { createClient, requireUserId } from "@/lib/supabase/server";

/**
 * Sources (`research_citations`) for a project.
 *
 * Added in Phase 16 alongside the F2 fix. The schema and the retrieval path
 * had supported citation keys since Phase 2, and the discussion generator and
 * exporter both read from this table — but nothing in the app ever wrote to
 * it, so every project had zero sources and the new "link this document to
 * its source" control would have offered an empty list forever.
 */
const createSchema = z.object({
  // The key the researcher will actually type in their draft, so it is theirs
  // to choose. Constrained to what extractCitationKeys()'s bracket
  // convention can round-trip: anything outside [A-Za-z0-9_-] would be
  // written as [key] and then not match itself on the way back.
  citationKey: z
    .string()
    .trim()
    .min(2)
    .max(64)
    .regex(/^[A-Za-z0-9_-]+$/, "Use letters, numbers, hyphens and underscores only"),
  title: z.string().trim().max(500).optional(),
  authors: z.array(z.string().trim().max(200)).max(50).optional(),
  year: z.number().int().min(1500).max(2200).optional(),
  journal: z.string().trim().max(300).optional(),
  doi: z.string().trim().max(200).optional(),
  url: z.string().trim().url().max(2000).optional(),
  sourceType: z.string().trim().max(80).optional(),
});

async function authorize(projectId: string) {
  let userId: string | null;
  try {
    userId = await requireUserId();
  } catch {
    return { error: NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 }) };
  }
  if (!userId) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const supabase = await createClient();

  let project;
  try {
    project = await getProject(supabase, projectId);
  } catch {
    return { error: NextResponse.json({ error: "Database temporarily unavailable" }, { status: 503 }) };
  }
  // 404 rather than 403 for a project that isn't the caller's: RLS already
  // makes it invisible, and this keeps the response identical whether it
  // belongs to someone else or does not exist.
  if (!project) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) };

  return { supabase };
}

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await authorize(projectId);
  if (auth.error) return auth.error;

  try {
    return NextResponse.json({ citations: await listCitations(auth.supabase, projectId) });
  } catch (err) {
    return NextResponse.json({ error: (err as DbError).message }, { status: 500 });
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await authorize(projectId);
  if (auth.error) return auth.error;

  try {
    const citation = await upsertCitation(auth.supabase, {
      project_id: projectId,
      citation_key: parsed.data.citationKey,
      title: parsed.data.title ?? null,
      authors: parsed.data.authors ?? [],
      year: parsed.data.year ?? null,
      journal: parsed.data.journal ?? null,
      doi: parsed.data.doi ?? null,
      url: parsed.data.url ?? null,
      source_type: parsed.data.sourceType ?? null,
      // A source the researcher entered by hand is exactly that — never
      // "verified", which in EvidenceStatus means the claim was checked
      // against the source itself.
      status: "user_provided",
    });
    return NextResponse.json({ citation }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as DbError).message }, { status: 500 });
  }
}
