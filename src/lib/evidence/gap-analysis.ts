import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIOrchestrator } from "../ai/orchestrator";
import { parseAIJson } from "../ai/parse-ai-json";
import { getCitationsByIds } from "../db/citations";
import { getSourceProfiles } from "../db/source-profiles";
import type { GapBasis, ResearchGapInsert } from "../db/types";
import { contentWords } from "./ranking";

/**
 * Research gap analysis (§23-§24).
 *
 * The interesting part is not producing gap statements — it is refusing to
 * let one be filed under a basis it has not earned. A model asked to label its
 * own output will happily call an inference "stated by the source", and a
 * matrix that prints that turns a guess into a citable fact.
 *
 * So the basis a model claims is checked before it is stored:
 * `source_stated` survives only when the supporting sentence it quotes is
 * actually present in that source's extracted text, and `derived_limitation`
 * survives only when the source has a recorded limitation. Everything that
 * fails is downgraded to `ai_inference`, never dropped — the observation may
 * still be useful, it is just not a source fact.
 */
export const gapSuggestionResponseSchema = z.object({
  gaps: z
    .array(
      z.object({
        text: z.string().min(1),
        /** "" when the gap is about the literature rather than one study. */
        citationKey: z.string(),
        basis: z.enum(["source_stated", "derived_limitation", "ai_inference"]),
        /** The sentence the basis rests on, verbatim from the source. "" when inferred. */
        supportingText: z.string(),
      }),
    )
    .max(20),
});

export const GAP_SUGGESTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    gaps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "What the literature does not answer." },
          citationKey: { type: "string", description: "The source, or \"\" if across the literature." },
          basis: { type: "string", enum: ["source_stated", "derived_limitation", "ai_inference"] },
          supportingText: {
            type: "string",
            description: "Verbatim sentence from the source supporting the basis, or \"\".",
          },
        },
        required: ["text", "citationKey", "basis", "supportingText"],
        additionalProperties: false,
      },
    },
  },
  required: ["gaps"],
  additionalProperties: false,
} as const;

const INSTRUCTION = [
  "Identify what the sources below leave unanswered.",
  "",
  "Rules:",
  '- basis "source_stated" only when the source itself says the question is open, and quote that sentence verbatim in supportingText.',
  '- basis "derived_limitation" only when it follows from a limitation the source states; quote that limitation.',
  '- basis "ai_inference" for anything you worked out. This is not a lesser answer — label it honestly.',
  "- Use only the citation keys given, or \"\" for a gap across the literature.",
].join("\n");

/**
 * Is the quoted sentence really in the source's extracted facts?
 *
 * Compared on content words rather than characters, because a model
 * reproducing a sentence will normalise whitespace and punctuation. A
 * threshold, not equality: this is a check against invention, not a plagiarism
 * detector.
 */
function quoteIsGrounded(quote: string, sourceText: string): boolean {
  const quoted = contentWords(quote);
  if (quoted.length < 3) return false;
  const haystack = new Set(contentWords(sourceText));
  const hits = quoted.filter((w) => haystack.has(w)).length;
  return hits / quoted.length >= 0.8;
}

export interface GapSuggestion extends ResearchGapInsert {
  /** Set when the model's claimed basis did not survive the check. */
  downgradedFrom?: GapBasis;
}

export async function suggestGaps(
  supabase: SupabaseClient,
  params: { projectId: string; citationIds: string[]; topic?: string; userId?: string },
): Promise<GapSuggestion[]> {
  const ids = [...new Set(params.citationIds)];
  if (ids.length === 0) return [];

  const [citations, profiles] = await Promise.all([
    getCitationsByIds(supabase, ids),
    getSourceProfiles(supabase, params.projectId, ids),
  ]);
  const inProject = citations.filter((c) => c.project_id === params.projectId);
  if (inProject.length === 0) return [];

  const profileByCitation = new Map(profiles.map((p) => [p.citation_id, p]));
  const keyToCitation = new Map(inProject.map((c) => [c.citation_key, c]));

  // Extracted profiles only, not documents (§36). A gap analysis works over
  // what the sources were found to say, which is what a profile is.
  const summary = inProject
    .map((c) => {
      const p = profileByCitation.get(c.id);
      const facts = p
        ? [
            p.population && `Population: ${p.population}`,
            p.study_design && `Design: ${p.study_design}`,
            p.sample && `Sample: ${p.sample}`,
            p.main_finding && `Finding: ${p.main_finding}`,
            p.limitations && `Limitations: ${p.limitations}`,
          ]
            .filter(Boolean)
            .join("\n  ")
        : "(no profile extracted)";
      return `[${c.citation_key}] ${c.title ?? "(untitled)"}${c.year ? ` (${c.year})` : ""}\n  ${facts}`;
    })
    .join("\n\n");

  const orchestrator = new AIOrchestrator({ userId: params.userId, supabase });
  const response = await orchestrator.generate({
    projectId: params.projectId,
    taskType: "research_gap",
    message: `${INSTRUCTION}${params.topic ? `\n\nResearch topic: ${params.topic}` : ""}\n\n---\nSOURCES:\n${summary}`,
    responseSchema: GAP_SUGGESTION_JSON_SCHEMA as unknown as Record<string, unknown>,
  });

  const parsed = parseAIJson({ raw: response.content, schema: gapSuggestionResponseSchema, task: "research gaps" });
  if (!parsed.ok) return [];

  return parsed.data.gaps.flatMap((g) => {
    const citation = g.citationKey ? keyToCitation.get(g.citationKey) : undefined;
    // A key the model invented means the attribution is wrong, not that the
    // observation is: it becomes an unattributed inference.
    const citationId = citation?.id ?? null;
    const profile = citationId ? profileByCitation.get(citationId) : undefined;

    let basis: GapBasis = g.basis;
    let downgradedFrom: GapBasis | undefined;

    if (basis === "source_stated") {
      const grounded =
        Boolean(citationId) &&
        Boolean(profile) &&
        quoteIsGrounded(
          g.supportingText,
          [profile?.limitations, profile?.main_finding, profile?.relevance].filter(Boolean).join(" "),
        );
      if (!grounded) {
        downgradedFrom = "source_stated";
        basis = "ai_inference";
      }
    } else if (basis === "derived_limitation") {
      if (!profile?.limitations) {
        downgradedFrom = "derived_limitation";
        basis = "ai_inference";
      }
    }

    return [
      {
        project_id: params.projectId,
        citation_id: citationId,
        gap_text: g.text.trim(),
        basis,
        supporting_text: g.supportingText.trim() || null,
        // Nothing suggested is verified. §24: never convert inference into
        // verified fact — verification is an action a researcher takes.
        verified: false,
        ...(downgradedFrom ? { downgradedFrom } : {}),
      },
    ];
  });
}
