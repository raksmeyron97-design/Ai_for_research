import type { SupabaseClient } from "@supabase/supabase-js";
import type { ProviderName, ResearchWarning, TaskType } from "./types";

const RESULTS_TASK_TYPES: TaskType[] = ["results_generation", "data_analysis"];

/**
 * Section 19's rule ("Real research data is required... This rule is
 * mandatory") as code, not just a prompt instruction. Prior phases only
 * asked the model not to fabricate results via
 * `research-integrity-guard.ts`'s prompt text — a model can still ignore
 * a prompt. This check runs before any provider is called, so a
 * results/analysis request with no dataset attached never reaches a
 * model at all: there's nothing for it to hallucinate around.
 */
export function requiresDataset(taskType: TaskType): boolean {
  return RESULTS_TASK_TYPES.includes(taskType);
}

export interface NoDatasetResponse {
  content: string;
  provider: ProviderName;
  model: string;
  warnings: ResearchWarning[];
}

export function buildNoDatasetResponse(provider: ProviderName, model: string): NoDatasetResponse {
  return {
    content: [
      "Real research data is required before generating empirical results.",
      "",
      "Available:",
      "- Results structure",
      "- Table templates",
      "- Analysis plan",
      "- Placeholder labels",
      "",
      "Missing:",
      "- Dataset",
    ].join("\n"),
    provider,
    model,
    warnings: [
      {
        severity: "critical",
        category: "data_integrity",
        message: "No dataset was attached to this request; empirical results were not generated.",
        recommendation: "Attach a dataset (dataSetId) before requesting results or data analysis.",
      },
    ],
  };
}

/**
 * Citations are expected in `[citation_key]` bracket form (the same
 * convention `context-manager.ts`'s formatCitations uses when it feeds
 * sources into a prompt), so extracting them is a simple, bounded text
 * scan — not the "fragile regex parsing of critical AI output" Section
 * 36 warns against, which is about scraping structured data out of free
 * text instead of using a schema. This only catches citations in that
 * bracket convention; one written as plain prose without brackets won't
 * be flagged. A real code-level check for the intended/common case beats
 * a prompt-only promise, but it isn't a complete claim-extraction system.
 */
export function extractCitationKeys(text: string): string[] {
  const matches = text.matchAll(/\[([a-zA-Z0-9_-]+)\]/g);
  return [...new Set([...matches].map((m) => m[1]))];
}

/**
 * Cross-checks citation keys an AI response claims against what's
 * actually stored for this project. A key that doesn't resolve to a real
 * `research_citations` row is flagged — the response may have referenced
 * a source that was never verified/saved, or invented one outright.
 */
export async function verifyCitationKeys(
  supabase: SupabaseClient,
  projectId: string,
  mentionedKeys: string[],
): Promise<ResearchWarning[]> {
  if (mentionedKeys.length === 0) return [];

  const { data, error } = await supabase
    .from("research_citations")
    .select("citation_key")
    .eq("project_id", projectId)
    .in("citation_key", mentionedKeys);

  if (error) {
    // Verification failing shouldn't block the response — but shouldn't
    // silently claim everything's fine either. Surface it as its own
    // low-severity issue rather than throwing.
    return [
      {
        severity: "low",
        category: "citation_verification",
        message: `Citation verification could not run: ${error.message}`,
      },
    ];
  }

  const found = new Set((data as { citation_key: string }[]).map((c) => c.citation_key));
  const unverified = mentionedKeys.filter((key) => !found.has(key));

  return unverified.map((key) => ({
    severity: "high",
    category: "citation",
    message: `Citation "${key}" was referenced but does not match any saved source for this project.`,
    recommendation: `Verify "${key}" is real and add it to the project's sources, or remove the reference.`,
  }));
}

/** Convenience: pulls citation keys out of response text and verifies them in one call. */
export async function verifyCitationsInText(
  supabase: SupabaseClient,
  projectId: string,
  text: string,
): Promise<ResearchWarning[]> {
  return verifyCitationKeys(supabase, projectId, extractCitationKeys(text));
}
