import { NextResponse } from "next/server";
import { AllProvidersFailedError } from "@/lib/ai/errors";
import { runQualityCheck } from "@/lib/ai/quality-check";
import { getProject } from "@/lib/db/projects";
import { createClient, requireUserId } from "@/lib/supabase/server";

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
  const project = await getProject(supabase, projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const result = await runQualityCheck(supabase, projectId, { userId });
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof AllProvidersFailedError) {
      return NextResponse.json(
        { error: "AI providers are currently unavailable. Please try again shortly." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
