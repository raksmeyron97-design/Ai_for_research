import type { SupabaseClient } from "@supabase/supabase-js";
import { SECTION_LABELS } from "../db/types";
import { getProject } from "../db/projects";
import { listSections } from "../db/sections";
import { parseAIJson } from "./parse-ai-json";
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

  const orchestrator = new AIOrchestrator({ userId: options.userId, supabase });
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

/**
 * Controlled "did not complete" state. A malformed response must never read
 * as "no issues found": an empty issue list is the same shape as a clean
 * bill of health, so the failure is reported as its own issue instead
 * (finding F10).
 */
function parseAlignmentResponse(content: string): ResearchWarning[] {
  const result = parseAIJson({ raw: content, schema: alignmentResponseSchema, task: "alignment check" });

  if (!result.ok) {
    return [
      {
        severity: "medium",
        category: "system",
        message: `${result.message} The alignment check did not complete — review the chain manually rather than treating this as "no issues found".`,
        recommendation: "Re-run the alignment check; if it keeps failing, the model is not honouring the response schema.",
      },
    ];
  }

  return result.data.issues.map((issue) => ({
    ...issue,
    section: issue.section || undefined,
    recommendation: issue.recommendation || undefined,
  }));
}
