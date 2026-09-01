import { NextResponse } from "next/server";
import { AllProvidersFailedError } from "@/lib/ai/errors";
import { requiresDataset } from "@/lib/ai/integrity-guard";
import { AIOrchestrator } from "@/lib/ai/orchestrator";
import { resolveRequestContext } from "@/lib/ai/prepare-request";
import { aiRequestSchema } from "@/lib/ai/request-schema";
import { getProject } from "@/lib/db/projects";
import { createClient, requireUserId } from "@/lib/supabase/server";

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

  const supabase = await createClient();
  const project = await getProject(supabase, parsed.data.projectId);
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const orchestrator = new AIOrchestrator({ userId });

  // Checked here too, not just inside AIOrchestrator.generate(): context
  // assembly (buildContext -> embedQuery) is real, billable work that a
  // blocked request has no use for — skip straight to the orchestrator's
  // own guard rather than embedding a query for a response we're about
  // to discard.
  const skipContext = requiresDataset(parsed.data.taskType) && !parsed.data.dataSetId;

  try {
    const requestWithContext = skipContext
      ? parsed.data
      : await resolveRequestContext(supabase, parsed.data);
    const response = await orchestrator.generate(requestWithContext);
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
