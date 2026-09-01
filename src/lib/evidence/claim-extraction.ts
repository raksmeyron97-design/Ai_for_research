import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIOrchestrator } from "../ai/orchestrator";
import { parseAIJson } from "../ai/parse-ai-json";
import { getProject } from "../db/projects";
import type { ClaimType, SectionType } from "../db/types";
import { claimNeedsEvidence } from "./status";

/**
 * Claim extraction (§11-§12).
 *
 * The model's job here is narrow: split a passage a researcher selected into
 * the assertions it makes, and propose a type for each. Everything with
 * consequences — whether a claim needs evidence, what status it starts in,
 * whether it is true — is decided by `status.ts` from the type, not by the
 * model. §12 says the classification is advisory, and this is what that means
 * in code: a model that labels every sentence `factual` produces more claims
 * needing evidence, never a claim marked as supported.
 *
 * Nothing is persisted here. Extraction returns candidates; the researcher
 * edits them and chooses which to keep (§11), and only then are rows written.
 */
const CLAIM_TYPES = [
  "factual",
  "statistical",
  "clinical",
  "comparative",
  "interpretive",
  "user_provided",
  "inference",
] as const;

export const claimExtractionResponseSchema = z.object({
  claims: z
    .array(
      z.object({
        text: z.string().min(1),
        type: z.enum(CLAIM_TYPES),
        /** Why the model chose that type. Shown to the researcher, who may disagree. */
        reason: z.string(),
        /** The sentence in the passage this came from, verbatim, or "" if paraphrased. */
        sourceSentence: z.string(),
      }),
    )
    .max(30),
});
export type ClaimExtractionResponse = z.infer<typeof claimExtractionResponseSchema>;

export const CLAIM_EXTRACTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    claims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "The assertion, as one standalone sentence." },
          type: { type: "string", enum: [...CLAIM_TYPES] },
          reason: { type: "string", description: "Why this type; \"\" if obvious." },
          sourceSentence: { type: "string", description: "Verbatim sentence it came from, or \"\"." },
        },
        required: ["text", "type", "reason", "sourceSentence"],
        additionalProperties: false,
      },
    },
  },
  required: ["claims"],
  additionalProperties: false,
} as const;

const INSTRUCTION = [
  "Split the passage below into the distinct assertions it makes.",
  "",
  "Rules:",
  "- One assertion per item, rewritten as a standalone sentence that keeps the original hedging. Do not strengthen a hedge into a certainty.",
  "- Classify each: factual, statistical, clinical, comparative, interpretive, user_provided, inference.",
  "- interpretive = the author's own reading. inference = a conclusion drawn rather than reported. user_provided = the author's own data.",
  "- Do not add assertions the passage does not make, and do not judge whether any assertion is true.",
  "- Text that only frames or connects (\"This chapter describes...\") is not an assertion; leave it out.",
].join("\n");

export interface ExtractedClaim {
  text: string;
  type: ClaimType;
  reason: string;
  sourceSentence: string;
  /** Derived, not asked for: `status.ts` owns this rule (§12). */
  needsEvidence: boolean;
  /** Character range in the passage, when the source sentence was found verbatim. */
  offsetStart: number | null;
  offsetEnd: number | null;
}

export class ClaimExtractionError extends Error {
  constructor(
    message: string,
    /** Safe to show a researcher; never a raw provider error (§39). */
    public readonly userMessage: string,
  ) {
    super(message);
    this.name = "ClaimExtractionError";
  }
}

export interface ExtractClaimsParams {
  projectId: string;
  section: SectionType;
  /** The paragraph or range the researcher selected. */
  passage: string;
  userId?: string;
  /** Character offset of `passage` within the full section, for claim offsets. */
  passageOffset?: number;
}

/**
 * Locates a claim in the passage. Best-effort by design: the section text
 * changes underneath, so an offset locates a claim for review, it does not pin
 * it — which is why `research_claims` treats these columns as advisory.
 */
function locate(passage: string, sentence: string, base: number): [number | null, number | null] {
  if (!sentence.trim()) return [null, null];
  const index = passage.indexOf(sentence.trim());
  if (index < 0) return [null, null];
  return [base + index, base + index + sentence.trim().length];
}

export async function extractClaims(
  supabase: SupabaseClient,
  params: ExtractClaimsParams,
): Promise<ExtractedClaim[]> {
  const passage = params.passage.trim();
  if (!passage) return [];

  const project = await getProject(supabase, params.projectId);
  if (!project) throw new ClaimExtractionError("project not found", "Project not found.");

  const orchestrator = new AIOrchestrator({ userId: params.userId, supabase });

  let response;
  try {
    response = await orchestrator.generate({
      projectId: params.projectId,
      taskType: "document_review",
      sectionId: params.section,
      // §36: the passage and nothing else. Extraction does not need the
      // thesis, the source library or the conversation — it needs the text in
      // front of it, and sending more would cost tokens to make the answer
      // worse by giving the model other sentences to extract from.
      message: `${INSTRUCTION}\n\n---\nPASSAGE:\n${passage}`,
      language: project.language,
      responseSchema: CLAIM_EXTRACTION_JSON_SCHEMA as unknown as Record<string, unknown>,
    });
  } catch {
    throw new ClaimExtractionError(
      "claim extraction provider call failed",
      "Claim extraction could not run. Nothing was saved — you can retry.",
    );
  }

  const parsed = parseAIJson({
    raw: response.content,
    schema: claimExtractionResponseSchema,
    task: "claim extraction",
  });
  if (!parsed.ok) {
    throw new ClaimExtractionError(
      `claim extraction response failed validation: ${parsed.reason}`,
      `${parsed.message} Nothing was saved — try again.`,
    );
  }

  const base = params.passageOffset ?? 0;

  return parsed.data.claims
    .map((c) => {
      const [offsetStart, offsetEnd] = locate(passage, c.sourceSentence, base);
      return {
        text: c.text.trim(),
        type: c.type as ClaimType,
        reason: c.reason,
        sourceSentence: c.sourceSentence,
        needsEvidence: claimNeedsEvidence(c.type as ClaimType),
        offsetStart,
        offsetEnd,
      };
    })
    .filter((c) => c.text.length > 0);
}
