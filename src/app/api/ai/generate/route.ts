import { NextResponse } from "next/server";
import { AllProvidersFailedError } from "@/lib/ai/errors";
import { AIOrchestrator } from "@/lib/ai/orchestrator";
import { aiRequestSchema } from "@/lib/ai/request-schema";
import { requireUserId } from "@/lib/supabase/server";

export async function POST(req: Request) {
  let userId: string | null;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = aiRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  // TODO(Phase 2): verify the caller owns projectId once ResearchProject +
  // RLS policies exist. Until then this only proves the caller is
  // authenticated, not that they own this project.

  const orchestrator = new AIOrchestrator({ userId });

  try {
    const response = await orchestrator.generate(parsed.data);
    return NextResponse.json(response);
  } catch (err) {
    if (err instanceof AllProvidersFailedError) {
      return NextResponse.json(
        { error: "AI providers are currently unavailable. Please try again shortly." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "AI request failed" }, { status: 500 });
  }
}
