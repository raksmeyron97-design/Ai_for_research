import { NextResponse } from "next/server";
import { AllProvidersFailedError } from "@/lib/ai/errors";
import { ConclusionGenerationError, generateConclusion } from "@/lib/ai/conclusion-generator";
import { getProject } from "@/lib/db/projects";
import { getCachedIdempotentResponse, getIdempotencyKey, saveIdempotentResponse } from "@/lib/security/idempotency";
import { checkRateLimit, RATE_LIMITS, rateLimitResponseBody } from "@/lib/security/rate-limit";
import { createClient, requireUserId } from "@/lib/supabase/server";

const IDEMPOTENCY_ROUTE = "conclusion_generate";

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
    const result = await generateConclusion(supabase, projectId, { userId });
    if (idempotencyKey) {
      await saveIdempotentResponse(supabase, userId, IDEMPOTENCY_ROUTE, idempotencyKey, 200, result);
    }
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ConclusionGenerationError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    if (err instanceof AllProvidersFailedError) {
      return NextResponse.json(
        { error: "AI providers are currently unavailable. Please try again shortly." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Conclusion generation failed" }, { status: 500 });
  }
}
