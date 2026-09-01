import type { SupabaseClient } from "@supabase/supabase-js";
import { listCitations } from "../db/citations";
import { getProject } from "../db/projects";
import { getSection } from "../db/sections";
import { verifyCitationsInText } from "./integrity-guard";
import { AIOrchestrator } from "./orchestrator";
import type { ResearchWarning } from "./types";

export class DiscussionGenerationError extends Error {}

export interface DiscussionResult {
  content: string;
  warnings: ResearchWarning[];
}

/**
 * Generates a Discussion section (spec §30: Result -> Interpretation ->
 * Comparison with literature -> Agreement/disagreement -> Possible
 * explanation -> Implication per finding). Two things are enforced by
 * code, not just prompted for:
 *
 * 1. There must be real Results content to discuss — a hard guard, same
 *    shape as Phase 5's dataset guard for results_generation/
 *    data_analysis. Discussing findings that don't exist yet is exactly
 *    the fabrication risk Section 19 is about, just one section later
 *    in the chain.
 * 2. Any citation the model references is checked against real stored
 *    `research_citations` after the fact, reusing the same
 *    `verifyCitationsInText()` the quality checker uses (Phase 5) — an
 *    invented or unverified source shows up as a warning, not silently.
 */
export async function generateDiscussion(
  supabase: SupabaseClient,
  projectId: string,
  options: { userId?: string } = {},
): Promise<DiscussionResult> {
  const project = await getProject(supabase, projectId);
  if (!project) throw new DiscussionGenerationError(`Project ${projectId} not found`);

  const [results, objectives, citations] = await Promise.all([
    getSection(supabase, projectId, "results"),
    getSection(supabase, projectId, "objectives"),
    listCitations(supabase, projectId),
  ]);

  if (!results?.content.trim()) {
    throw new DiscussionGenerationError(
      "The Results section is empty. A discussion needs real findings to interpret — write or generate Results first.",
    );
  }

  const context = buildContext(project.title, results.content, objectives?.content ?? null, citations);

  const orchestrator = new AIOrchestrator({ userId: options.userId });
  const response = await orchestrator.generate({
    projectId,
    taskType: "discussion",
    message: "Write the Discussion section for this project, following the required structure for each finding.",
    context,
    sourceIds: citations.map((c) => c.id),
  });

  const warnings = await verifyCitationsInText(supabase, projectId, response.content);
  if (citations.length === 0 && !/additional evidence required/i.test(response.content)) {
    warnings.push({
      severity: "medium",
      category: "citation",
      message:
        "This project has no saved sources, but the discussion doesn't say literature comparison needs evidence — review it for any comparison that isn't actually backed by a real source.",
    });
  }

  return { content: response.content, warnings };
}

function buildContext(
  projectTitle: string,
  results: string,
  objectives: string | null,
  citations: { citation_key: string; title: string | null; year: number | null; authors: string[] }[],
): string {
  const parts = [
    `## Project\n${projectTitle}`,
    objectives && `## Objectives\n${objectives}`,
    `## Results\n${results}`,
    citations.length > 0
      ? `## Available Sources (only compare against these — use their exact [citation_key])\n${citations
          .map((c) => `[${c.citation_key}] ${c.authors.join(", ") || "(no authors given)"} (${c.year ?? "n.d."}) — ${c.title ?? "(untitled)"}`)
          .join("\n")}`
      : "## Available Sources\n(none saved for this project — mark any literature comparison as \"Additional evidence required\")",
  ];
  return parts.filter((p): p is string => Boolean(p)).join("\n\n");
}
