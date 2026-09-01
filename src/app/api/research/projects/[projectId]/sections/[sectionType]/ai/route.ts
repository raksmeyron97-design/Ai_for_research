import { NextResponse } from "next/server";
import { z } from "zod";
import { runSectionAction, SectionActionError } from "@/lib/ai/sections/run-action";
import { getSectionActions } from "@/lib/ai/sections/actions";
import { sectionTypeSchema } from "@/lib/db/project-schema";
import { getProject } from "@/lib/db/projects";
import { checkRateLimit, RATE_LIMITS, rateLimitResponseBody } from "@/lib/security/rate-limit";
import { createClient, requireUserId } from "@/lib/supabase/server";

const bodySchema = z.object({
  actionId: z.enum([
    "generate", "improve", "rewrite", "explain", "review",
    "check_alignment", "add_evidence", "shorten", "expand", "translate",
  ]),
  instruction: z.string().max(20_000).optional(),
  language: z.enum(["km", "en"]).optional(),
  dataSetId: z.string().uuid().optional(),
  documentIds: z.array(z.string().uuid()).max(20).optional(),
  sourceIds: z.array(z.string().uuid()).max(50).optional(),
});

/** Lists the actions this section offers, so the UI never has to hard-code them. */
export async function GET(_req: Request, { params }: { params: Promise<{ sectionType: string }> }) {
  const { sectionType } = await params;
  const parsedType = sectionTypeSchema.safeParse(sectionType);
  if (!parsedType.success) return NextResponse.json({ error: "Unknown section type" }, { status: 400 });
  return NextResponse.json({ actions: getSectionActions(parsedType.data) });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; sectionType: string }> },
) {
  const { projectId, sectionType } = await params;

  const parsedType = sectionTypeSchema.safeParse(sectionType);
  if (!parsedType.success) return NextResponse.json({ error: "Unknown section type" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  let userId: string | null;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();

  const rateLimit = await checkRateLimit(supabase, userId, RATE_LIMITS.aiRequest);
  if (!rateLimit.allowed) {
    return NextResponse.json(rateLimitResponseBody(rateLimit), { status: 429 });
  }

  const project = await getProject(supabase, projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const result = await runSectionAction(supabase, {
      projectId,
      section: parsedType.data,
      actionId: parsed.data.actionId,
      instruction: parsed.data.instruction,
      language: parsed.data.language,
      dataSetId: parsed.data.dataSetId,
      documentIds: parsed.data.documentIds,
      sourceIds: parsed.data.sourceIds,
      userId,
    });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof SectionActionError) {
      // userMessage is written for a researcher; the underlying error is not
      // echoed back (§28). `contentSaved` is explicit because "did I lose my
      // work" is the first thing a student wants to know.
      return NextResponse.json({ error: err.userMessage, contentSaved: false, retryable: true }, { status: 422 });
    }
    return NextResponse.json(
      { error: "The AI action could not be completed. Nothing was saved.", contentSaved: false, retryable: true },
      { status: 500 },
    );
  }
}
