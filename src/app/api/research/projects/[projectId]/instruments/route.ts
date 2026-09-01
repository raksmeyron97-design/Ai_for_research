import { NextResponse } from "next/server";
import { AllProvidersFailedError } from "@/lib/ai/errors";
import { generateQuestionnaire, QuestionnaireGenerationError } from "@/lib/ai/questionnaire-generator";
import { listInstruments } from "@/lib/db/instruments";
import { getProject } from "@/lib/db/projects";
import { getCachedIdempotentResponse, getIdempotencyKey, saveIdempotentResponse } from "@/lib/security/idempotency";
import { checkRateLimit, RATE_LIMITS, rateLimitResponseBody } from "@/lib/security/rate-limit";
import { createClient, requireUserId } from "@/lib/supabase/server";

const IDEMPOTENCY_ROUTE = "questionnaire_generate";

export async function GET(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  let userId: string | null;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const project = await getProject(supabase, projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  const instruments = await listInstruments(supabase, projectId);
  return NextResponse.json({ instruments });
}

/** Generates a new questionnaire via AI and persists it — see questionnaire-generator.ts for why a bad response is never partially saved. */
export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  let userId: string | null;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();

  // A double-click or a client retry after a slow/dropped response would
  // otherwise create a whole second instrument + question set — this is
  // the highest-value idempotency case in the app (Phase 15 §6), since
  // unlike discussion/conclusion generation this route actually persists
  // new rows on every call. Opt-in: only checked when the client sends
  // the header (QuestionnaireBuilder.tsx does).
  const idempotencyKey = getIdempotencyKey(req);
  if (idempotencyKey) {
    const cached = await getCachedIdempotentResponse(supabase, userId, IDEMPOTENCY_ROUTE, idempotencyKey);
    if (cached) return NextResponse.json(cached.body, { status: cached.status });
  }

  const rateLimit = await checkRateLimit(supabase, userId, RATE_LIMITS.aiRequest);
  if (!rateLimit.allowed) {
    return NextResponse.json(rateLimitResponseBody(rateLimit), { status: 429 });
  }

  const project = await getProject(supabase, projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const result = await generateQuestionnaire(supabase, projectId, { userId });
    if (idempotencyKey) {
      await saveIdempotentResponse(supabase, userId, IDEMPOTENCY_ROUTE, idempotencyKey, 201, result);
    }
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof QuestionnaireGenerationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof AllProvidersFailedError) {
      return NextResponse.json(
        { error: "AI providers are currently unavailable. Please try again shortly." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Questionnaire generation failed" }, { status: 500 });
  }
}
