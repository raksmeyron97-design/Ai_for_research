import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import { createGaps, listGaps } from "@/lib/db/gaps";

const createSchema = z.object({
  gaps: z
    .array(
      z.object({
        text: z.string().trim().min(1).max(2000),
        citationId: z.string().uuid().nullable().optional(),
        basis: z.enum([
          "source_stated",
          "derived_limitation",
          "ai_inference",
          "user_observation",
          "needs_verification",
        ]),
        supportingText: z.string().trim().max(4000).nullable().optional(),
      }),
    )
    .min(1)
    .max(20),
});

export async function GET(_req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    return NextResponse.json({ gaps: await listGaps(auth.auth.supabase, projectId) });
  } catch {
    return dbErrorResponse("Loading research gaps");
  }
}

/**
 * Saves gaps the researcher accepted (§23-§24).
 *
 * `verified` is never accepted from the client. A gap becomes verified only
 * through the explicit PATCH on the gap itself, so "the researcher checked
 * this" cannot be set in the same request that created the row.
 */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  // A gap with no source cannot claim a source stated it — the database
  // enforces this too, but a 400 explains it and a constraint violation does
  // not.
  const orphanStated = parsed.data.gaps.find((g) => g.basis === "source_stated" && !g.citationId);
  if (orphanStated) {
    return NextResponse.json(
      { error: 'A gap marked "stated by source" has to name the source that states it.' },
      { status: 400 },
    );
  }

  const auth = await authorizeProject(projectId);
  if (!auth.ok) return auth.response;

  try {
    const gaps = await createGaps(
      auth.auth.supabase,
      parsed.data.gaps.map((g) => ({
        project_id: projectId,
        citation_id: g.citationId ?? null,
        gap_text: g.text,
        basis: g.basis,
        supporting_text: g.supportingText ?? null,
        verified: false,
      })),
    );
    return NextResponse.json({ gaps }, { status: 201 });
  } catch {
    return dbErrorResponse("Saving those gaps");
  }
}
