import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject } from "@/lib/api/authorize";
import { suggestGaps } from "@/lib/evidence/gap-analysis";

const bodySchema = z.object({
  citationIds: z.array(z.string().uuid()).min(1).max(20),
});

/**
 * Proposes gaps. Writes nothing.
 *
 * Each suggestion carries the basis that survived checking, and
 * `downgradedFrom` when the model's claimed basis did not — so the researcher
 * can see that "the source says this is open" became "this is an inference",
 * rather than the downgrade happening invisibly.
 */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Select at least one source." }, { status: 400 });

  const auth = await authorizeProject(projectId, { rateLimit: "ai" });
  if (!auth.ok) return auth.response;

  try {
    const suggestions = await suggestGaps(auth.auth.supabase, {
      projectId,
      citationIds: parsed.data.citationIds,
      topic: auth.auth.project.title,
      userId: auth.auth.userId,
    });
    return NextResponse.json({ suggestions });
  } catch {
    return NextResponse.json(
      { error: "Gap suggestions could not be generated. Nothing was saved." },
      { status: 502 },
    );
  }
}
