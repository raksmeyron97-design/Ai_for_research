import type { SupabaseClient } from "@supabase/supabase-js";
import type { SectionType } from "../../db/types";
import { AIOrchestrator } from "../orchestrator";
import { parseAIJson } from "../parse-ai-json";
import { verifyCitationsInText } from "../integrity-guard";
import type { ResearchWarning } from "../types";
import { findSectionAction, type SectionAction, type SectionActionId } from "./actions";
import { buildSectionContext } from "./section-context";
import {
  CONCEPTUAL_FRAMEWORK_JSON_SCHEMA,
  METHODOLOGY_REVIEW_JSON_SCHEMA,
  OBJECTIVES_JSON_SCHEMA,
  RESEARCH_QUESTIONS_JSON_SCHEMA,
  VARIABLES_JSON_SCHEMA,
  conceptualFrameworkResponseSchema,
  methodologyReviewResponseSchema,
  objectivesResponseSchema,
  researchQuestionsResponseSchema,
  variablesResponseSchema,
} from "./schemas";

export class SectionActionError extends Error {
  constructor(
    message: string,
    /** Safe to show a researcher; never a raw provider error (§28). */
    public readonly userMessage: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "SectionActionError";
  }
}

/**
 * Sections whose content must come from a dedicated generator with its own
 * guards. Routing "generate" here would create a second path to the same
 * content that skips those guards — exactly the duplication §32 forbids.
 */
const DELEGATED_GENERATION: Partial<Record<SectionType, string>> = {
  results: "Results are generated from a dataset. Use Generate Results in the Data panel.",
  discussion: "Discussion is generated from your Results. Use Generate Discussion draft.",
  conclusion: "Conclusion is generated from your Objectives and Results. Use Generate Conclusion draft.",
  questionnaire: "Questionnaires are generated in the Questionnaire builder, which saves the instrument and its items.",
};

/**
 * Section actions that ask for structured output, with the schema the
 * response must satisfy. Anything not listed returns prose.
 */
const STRUCTURED: Partial<
  Record<string, { json: Record<string, unknown>; zod: Parameters<typeof parseAIJson>[0]["schema"] }>
> = {
  "objectives:generate": { json: OBJECTIVES_JSON_SCHEMA, zod: objectivesResponseSchema },
  "research_questions:generate": { json: RESEARCH_QUESTIONS_JSON_SCHEMA, zod: researchQuestionsResponseSchema },
  "variables:generate": { json: VARIABLES_JSON_SCHEMA, zod: variablesResponseSchema },
  "conceptual_framework:generate": {
    json: CONCEPTUAL_FRAMEWORK_JSON_SCHEMA,
    zod: conceptualFrameworkResponseSchema,
  },
  "methodology:review": { json: METHODOLOGY_REVIEW_JSON_SCHEMA, zod: methodologyReviewResponseSchema },
};

export interface RunSectionActionParams {
  projectId: string;
  section: SectionType;
  actionId: SectionActionId;
  /** Free-text steer from the researcher, e.g. selected paragraph or a note. */
  instruction?: string;
  language?: "km" | "en";
  dataSetId?: string;
  documentIds?: string[];
  sourceIds?: string[];
  userId?: string;
}

export interface SectionActionResult {
  action: SectionAction;
  /** Prose to show, or a rendering of the structured payload. */
  content: string;
  /** Present only when the action has a schema and the response validated. */
  structured?: unknown;
  warnings: ResearchWarning[];
  /** Context layers actually used — surfaced so the UI can show what the AI saw. */
  contextLayers: string[];
  provider: string;
  model: string;
}

/**
 * Runs one section action through the production pipeline.
 *
 * Everything section-specific is resolved from the registries rather than
 * branched on here: which actions exist (`actions.ts`), what context the
 * section may see (`context-policy.ts`), and whether the output is structured
 * (`schemas.ts`). Adding a section means adding data, not another branch.
 */
export async function runSectionAction(
  supabase: SupabaseClient,
  params: RunSectionActionParams,
): Promise<SectionActionResult> {
  // Checked before the registry lookup. These sections deliberately have no
  // `generate` action, so a lookup would fail first with "not available" —
  // true, but useless. A researcher who clicked Generate on Results needs to
  // be told where generation actually lives.
  if (params.actionId === "generate" && DELEGATED_GENERATION[params.section]) {
    throw new SectionActionError(
      `Generation for ${params.section} is delegated to its dedicated generator`,
      DELEGATED_GENERATION[params.section] as string,
    );
  }

  const action = findSectionAction(params.section, params.actionId);
  if (!action) {
    throw new SectionActionError(
      `Action ${params.actionId} is not available for section ${params.section}`,
      "That action isn't available for this section.",
    );
  }

  const context = await buildSectionContext(supabase, {
    projectId: params.projectId,
    section: params.section,
    query: action.task === "source_search" || action.task === "literature_review"
      ? (params.instruction ?? undefined)
      : undefined,
    documentIds: params.documentIds,
    sourceIds: params.sourceIds,
    dataSetId: params.dataSetId,
  });

  if (action.requiresContent && !context.includedLayers.includes("currentSection")) {
    throw new SectionActionError(
      `Action ${params.actionId} requires existing section content`,
      "Write or generate some content first — this action works on what's already in the section.",
    );
  }

  const structured = STRUCTURED[`${params.section}:${params.actionId}`];

  const orchestrator = new AIOrchestrator({ userId: params.userId, supabase });
  let response;
  try {
    response = await orchestrator.generate({
      projectId: params.projectId,
      taskType: action.task,
      sectionId: params.section,
      message: params.instruction?.trim() || action.description,
      language: params.language,
      context: context.text || undefined,
      dataSetId: params.dataSetId,
      ...(structured ? { responseSchema: structured.json } : {}),
    });
  } catch (err) {
    // §28: never surface a raw provider error to a researcher.
    throw new SectionActionError(
      `Section action ${params.section}:${params.actionId} failed`,
      "The AI service didn't respond. Nothing was saved — you can retry.",
      err,
    );
  }

  const warnings: ResearchWarning[] = [...(response.warnings ?? [])];

  let structuredData: unknown;
  if (structured) {
    const parsed = parseAIJson({
      raw: response.content,
      schema: structured.zod,
      task: `${params.section} ${params.actionId}`,
    });
    if (!parsed.ok) {
      // No partial persistence, no repaired object: the caller gets a clean
      // failure and the section is untouched (§7).
      throw new SectionActionError(
        `Structured response failed validation: ${parsed.reason}`,
        `${parsed.message} Nothing was saved — try again.`,
      );
    }
    structuredData = parsed.data;
  }

  // The same citation check the API routes run, so a section action cannot
  // become a path that skips verification.
  try {
    warnings.push(...(await verifyCitationsInText(supabase, params.projectId, response.content)));
  } catch {
    // Best-effort; a verification failure never fails a delivered answer.
  }

  return {
    action,
    content: response.content,
    structured: structuredData,
    warnings,
    contextLayers: context.includedLayers,
    provider: response.provider,
    model: response.model,
  };
}
