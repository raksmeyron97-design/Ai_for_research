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
 * Every `[token]` in the text, citation-shaped or not. The raw material for
 * the two-stage check in `verifyCitationsInText`.
 */
export function extractBracketTokens(text: string): string[] {
  const matches = text.matchAll(/\[([A-Za-z0-9_-]+)\]/g);
  return [...new Set([...matches].map((m) => m[1]))];
}

/**
 * Citation-key grammar: starts with a letter, at least three characters,
 * letters/digits/underscore/hyphen only. `[smith2024]`, `[WHO2025]` and
 * `[abc_2024]` qualify; `[1]`, `[2]`, `[10]` do not.
 *
 * The leading-letter rule is what separates a citation from ordinary list
 * numbering, which is the whole point (finding F11). Before Phase 16A the
 * extractor matched any bracket token, so a model writing
 *
 *   [1] First point
 *   [2] Second point
 *
 * produced two "citation does not match any saved source" warnings. Harmless
 * while nothing surfaced them; user-visible once F3 started appending
 * citation warnings to the chat answer itself.
 *
 * This grammar is a *filter for candidates*, never the final authority — see
 * `verifyCitationsInText` for why a stored key that fails it is still
 * honoured.
 */
export function isCitationKeyShaped(token: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]{2,63}$/.test(token);
}

/**
 * Citation keys a response appears to claim. Bracket tokens that look like
 * list numbering are excluded here and handled separately.
 */
export function extractCitationKeys(text: string): string[] {
  return extractBracketTokens(text).filter(isCitationKeyShaped);
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

/**
 * Pulls citation keys out of response text and verifies them.
 *
 * Two stages, because a grammar alone would be wrong in both directions:
 *
 *  1. Key-shaped tokens (`[smith2024]`) are candidates — warned about when
 *     they resolve to no saved source. This keeps verification strict: an
 *     invented key is still caught.
 *  2. Tokens that are *not* key-shaped (`[1]`) are looked up too, but never
 *     warned about. If a project genuinely stores a source keyed "1", the
 *     reference is real and is honoured — the grammar must not silently
 *     discard a key that exists in the database. If it resolves to nothing,
 *     it is list numbering and is ignored rather than reported.
 *
 * The net effect: numbered lists stop producing false warnings, without
 * loosening what counts as an unverified citation.
 */
export async function verifyCitationsInText(
  supabase: SupabaseClient,
  projectId: string,
  text: string,
): Promise<ResearchWarning[]> {
  const tokens = extractBracketTokens(text);
  if (tokens.length === 0) return [];

  const candidates = tokens.filter(isCitationKeyShaped);
  const ambiguous = tokens.filter((t) => !isCitationKeyShaped(t));

  // Nothing citation-shaped and nothing that could be a stored key: skip the
  // query entirely rather than round-tripping for a numbered list.
  if (candidates.length === 0 && ambiguous.length === 0) return [];

  const { data, error } = await supabase
    .from("research_citations")
    .select("citation_key")
    .eq("project_id", projectId)
    .in("citation_key", [...candidates, ...ambiguous]);

  if (error) {
    return [
      {
        severity: "low",
        category: "citation_verification",
        message: `Citation verification could not run: ${error.message}`,
      },
    ];
  }

  const found = new Set((data as { citation_key: string }[]).map((c) => c.citation_key));

  return candidates
    .filter((key) => !found.has(key))
    .map((key) => ({
      severity: "high" as const,
      category: "citation",
      message: `Citation "${key}" was referenced but does not match any saved source for this project.`,
      recommendation: `Verify "${key}" is real and add it to the project's sources, or remove the reference.`,
    }));
}
