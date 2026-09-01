import type { SupabaseClient } from "@supabase/supabase-js";
import { SECTION_LABELS } from "../db/types";
import { getProject } from "../db/projects";
import { listSections } from "../db/sections";
import { ALIGNMENT_RESPONSE_JSON_SCHEMA, alignmentResponseSchema } from "./schemas";
import { AIOrchestrator } from "./orchestrator";
import type { ResearchWarning } from "./types";

/**
 * Walks the full Title -> ... -> Appendices chain and flags where later
 * sections don't line up with earlier ones (spec §20) — e.g. an
 * objective the methodology/instrument doesn't actually measure. This is
 * necessarily a semantic judgment (not something a code-level structural
 * check can do), so it goes through the model via `responseSchema` —
 * validated with Zod on the way back, not scraped from prose.
 */
export async function checkAlignment(
  supabase: SupabaseClient,
  projectId: string,
  options: { userId?: string } = {},
): Promise<ResearchWarning[]> {
  const project = await getProject(supabase, projectId);
  if (!project) {
    throw new Error(`checkAlignment: project ${projectId} not found`);
  }

  const sections = await listSections(supabase, projectId);
  const context = formatChainForReview(sections);

  if (!context) {
    return [
      {
        severity: "informational",
        category: "alignment",
        message: "No sections have content yet — nothing to check alignment against.",
      },
    ];
  }

  const orchestrator = new AIOrchestrator({ userId: options.userId });
  const response = await orchestrator.generate({
    projectId,
    taskType: "quality_check",
    message:
      "Check alignment across the full research chain: does each later section (objectives, questions, variables, methodology, instrument, analysis) actually follow from and support the earlier ones (title, problem, rationale)?",
    context,
    responseSchema: ALIGNMENT_RESPONSE_JSON_SCHEMA,
  });

  return parseAlignmentResponse(response.content);
}

function formatChainForReview(
  sections: { section_type: string; content: string }[],
): string | null {
  const withContent = sections.filter((s) => s.content.trim().length > 0);
  if (withContent.length === 0) return null;

  return withContent
    .map((s) => `## ${SECTION_LABELS[s.section_type as keyof typeof SECTION_LABELS] ?? s.section_type}\n${s.content}`)
    .join("\n\n");
}

function parseAlignmentResponse(content: string): ResearchWarning[] {
  try {
    const parsed = alignmentResponseSchema.parse(JSON.parse(content));
    return parsed.issues.map((issue) => ({
      ...issue,
      section: issue.section || undefined,
      recommendation: issue.recommendation || undefined,
    }));
  } catch {
    // A malformed response is itself worth surfacing, not swallowing —
    // the researcher should know the automated check didn't run cleanly
    // rather than silently seeing "no issues found."
    return [
      {
        severity: "low",
        category: "system",
        message: "The automated alignment check did not return a valid response. Review the chain manually.",
      },
    ];
  }
}
