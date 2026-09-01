import type { SupabaseClient } from "@supabase/supabase-js";
import { getProject } from "../db/projects";
import { getSection } from "../db/sections";
import { AIOrchestrator } from "./orchestrator";
import type { ResearchWarning } from "./types";

export class ConclusionGenerationError extends Error {}

export interface ConclusionResult {
  content: string;
  warnings: ResearchWarning[];
}

/**
 * Generates a Conclusion (+ recommendations) that spec §31 requires to
 * derive strictly from the objectives and existing findings — "never
 * introduce new results." Enforced two ways:
 *
 * 1. A hard guard: objectives and at least one of Results/Discussion
 *    must have real content, or there's nothing to conclude from.
 * 2. `detectUnsourcedNumbers()` — a code-level heuristic (not proof) that
 *    flags a number appearing in the conclusion that doesn't appear
 *    anywhere in the source content it was supposed to derive from. This
 *    can't distinguish "a genuinely new statistic" from "the same number
 *    written with different formatting" perfectly, so it's a warning to
 *    review, not a rejection — see the tests for exactly what it does
 *    and doesn't catch.
 */
export async function generateConclusion(
  supabase: SupabaseClient,
  projectId: string,
  options: { userId?: string } = {},
): Promise<ConclusionResult> {
  const project = await getProject(supabase, projectId);
  if (!project) throw new ConclusionGenerationError(`Project ${projectId} not found`);

  const [objectives, results, discussion] = await Promise.all([
    getSection(supabase, projectId, "objectives"),
    getSection(supabase, projectId, "results"),
    getSection(supabase, projectId, "discussion"),
  ]);

  if (!objectives?.content.trim()) {
    throw new ConclusionGenerationError(
      "The Objectives section is empty. A conclusion needs real objectives to check against — write or generate Objectives first.",
    );
  }
  const findingsSource = [results?.content, discussion?.content].filter(Boolean).join("\n\n");
  if (!findingsSource.trim()) {
    throw new ConclusionGenerationError(
      "Neither Results nor Discussion has content yet. A conclusion can't be written without real findings to synthesize.",
    );
  }

  const context = [
    `## Project\n${project.title}`,
    `## Objectives\n${objectives.content}`,
    results?.content && `## Results\n${results.content}`,
    discussion?.content && `## Discussion\n${discussion.content}`,
  ]
    .filter((p): p is string => Boolean(p))
    .join("\n\n");

  const orchestrator = new AIOrchestrator({ userId: options.userId });
  const response = await orchestrator.generate({
    projectId,
    taskType: "conclusion",
    message: "Write the Conclusion and Recommendations for this project, derived only from the objectives and findings given.",
    context,
  });

  const warnings = detectUnsourcedNumbers(response.content, `${objectives.content}\n${findingsSource}`);

  return { content: response.content, warnings };
}

const NUMBER_PATTERN = /\d+(\.\d+)?%?/g;

/**
 * Flags a number in `text` that doesn't appear anywhere in `sourceText`.
 * Years (four digits in a plausible research-paper range) are excluded
 * to cut down obvious false positives — a citation year or "since 2020"
 * isn't a statistic. This is a heuristic string-match, not semantic
 * verification: "50%" and "50.0%" are treated as different tokens, and a
 * genuinely new number that happens to also appear elsewhere in the
 * source text (e.g. a sample size mentioned incidentally) won't be
 * caught. Treat this as "worth a second look," not proof either way.
 */
export function detectUnsourcedNumbers(text: string, sourceText: string): ResearchWarning[] {
  const sourceNumbers = new Set(extractNumbers(sourceText));
  const candidateNumbers = extractNumbers(text).filter((n) => !isLikelyYear(n));

  const unsourced = [...new Set(candidateNumbers)].filter((n) => !sourceNumbers.has(n));

  if (unsourced.length === 0) return [];

  return [
    {
      severity: "high",
      category: "data_integrity",
      message: `The conclusion mentions ${unsourced.length === 1 ? "a number" : "numbers"} not found in the Objectives/Results/Discussion content it was generated from: ${unsourced.join(", ")}.`,
      recommendation: "Verify this isn't a newly introduced statistic — the conclusion should only synthesize findings that already exist elsewhere.",
    },
  ];
}

function extractNumbers(text: string): string[] {
  return [...text.matchAll(NUMBER_PATTERN)].map((m) => m[0]);
}

function isLikelyYear(token: string): boolean {
  const n = Number(token.replace("%", ""));
  return !token.includes("%") && !token.includes(".") && n >= 1900 && n <= 2099;
}
