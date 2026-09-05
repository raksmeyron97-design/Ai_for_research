import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIOrchestrator } from "../ai/orchestrator";
import { parseAIJson } from "../ai/parse-ai-json";
import { listCitations } from "../db/citations";
import type { ResearchCitationRow } from "../db/types";

/**
 * Theme suggestions (§22).
 *
 * A suggestion is a proposal, not a filing decision. Nothing here writes a
 * theme row: it returns candidates the UI marks `AI SUGGESTED`, and the
 * researcher confirms or discards them. Writing them directly and flagging
 * them afterwards would be the same thing with worse defaults — a list the
 * researcher has to clean up rather than one they built.
 */
export const themeSuggestionResponseSchema = z.object({
  themes: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string(),
        /** Citation keys the model thinks belong under it. */
        citationKeys: z.array(z.string()),
      }),
    )
    .max(12),
});

export const THEME_SUGGESTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    themes: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "Short noun phrase, e.g. \"Screening barriers\"." },
          description: { type: "string" },
          citationKeys: { type: "array", items: { type: "string" } },
        },
        required: ["name", "description", "citationKeys"],
        additionalProperties: false,
      },
    },
  },
  required: ["themes"],
  additionalProperties: false,
} as const;

const INSTRUCTION = [
  "Group the sources below into a small number of literature themes.",
  "",
  "Rules:",
  "- Use only the citation keys listed. Do not invent a source.",
  "- A source may appear under more than one theme, or under none.",
  "- Name themes for what the sources are about, not for the thesis structure.",
  "- Prefer 3-6 themes. Do not create a theme for a single source unless it genuinely stands alone.",
].join("\n");

export interface ThemeSuggestion {
  name: string;
  description: string;
  /** Resolved to real citations; a key the model invented is dropped. */
  citationIds: string[];
  /** Always true. The flag travels with the suggestion so nothing downstream has to remember. */
  aiSuggested: true;
}

export async function suggestThemes(
  supabase: SupabaseClient,
  params: { projectId: string; userId?: string },
): Promise<ThemeSuggestion[]> {
  const citations = await listCitations(supabase, params.projectId);
  if (citations.length < 2) return [];

  const keyToId = new Map<string, ResearchCitationRow>(citations.map((c) => [c.citation_key, c]));

  // Bibliographic lines only — not the documents, not their text (§36).
  // Grouping sources by topic does not need the sources.
  const list = citations
    .map((c) => `[${c.citation_key}] ${c.title ?? "(untitled)"}${c.year ? ` (${c.year})` : ""}`)
    .join("\n");

  const orchestrator = new AIOrchestrator({ userId: params.userId, supabase });
  const response = await orchestrator.generate({
    projectId: params.projectId,
    taskType: "literature_review",
    message: `${INSTRUCTION}\n\n---\nSOURCES:\n${list}`,
    responseSchema: THEME_SUGGESTION_JSON_SCHEMA as unknown as Record<string, unknown>,
  });

  const parsed = parseAIJson({
    raw: response.content,
    schema: themeSuggestionResponseSchema,
    task: "theme suggestions",
  });
  if (!parsed.ok) return [];

  return parsed.data.themes
    .map((t) => ({
      name: t.name.trim(),
      description: t.description.trim(),
      citationIds: t.citationKeys
        .map((k) => keyToId.get(k)?.id)
        .filter((id): id is string => Boolean(id)),
      aiSuggested: true as const,
    }))
    .filter((t) => t.name.length > 0);
}
