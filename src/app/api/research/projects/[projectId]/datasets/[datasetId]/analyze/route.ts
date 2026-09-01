import { NextResponse } from "next/server";
import { AllProvidersFailedError } from "@/lib/ai/errors";
import { generateResultsAnalysis, ResultsGenerationError } from "@/lib/ai/results-generator";
import { getProject } from "@/lib/db/projects";
import { createClient, requireUserId } from "@/lib/supabase/server";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ projectId: string; datasetId: string }> },
) {
  const { projectId, datasetId } = await params;

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
    const analysis = await generateResultsAnalysis(supabase, projectId, datasetId, { userId });
    return NextResponse.json(analysis);
  } catch (err) {
    if (err instanceof ResultsGenerationError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof AllProvidersFailedError) {
      return NextResponse.json(
        { error: "AI providers are currently unavailable. Please try again shortly." },
        { status: 503 },
      );
    }
    return NextResponse.json({ error: "Analysis failed" }, { status: 500 });
  }
}
