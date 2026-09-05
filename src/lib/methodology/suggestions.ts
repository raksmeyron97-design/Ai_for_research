import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AIOrchestrator } from "../ai/orchestrator";
import { parseAIJson } from "../ai/parse-ai-json";
import { getProject } from "../db/projects";
import { classifyQuestion } from "./question-classification";
import {
  BUDGETS,
  fitCandidates,
  fitText,
  renderCandidates,
  type Candidate,
  type ContextBudget,
} from "./context-budget";
import type {
  ConstructRole,
  HypothesisForm,
  HypothesisPosition,
  QuestionResponseType,
} from "../db/types";

/**
 * Methodology AI proposals (§16).
 *
 * Everything in this file returns proposals and writes nothing. That is the
 * boundary the whole phase rests on: the model may suggest a mapping, a
 * construct, a hypothesis or an item wording, and none of it becomes part of
 * the study until a researcher accepts it.
 *
 * Three rules are enforced in code rather than in the prompt, because a prompt
 * is a request and these are guarantees:
 *
 * 1. **Ids are echoed, never invented.** Every id the model returns is checked
 *    against the candidate list that was sent. An id that was not offered is
 *    discarded — which also means a cross-project id can never arrive, since
 *    only in-project rows are ever offered (§40).
 * 2. **Source provenance is not the model's to assert.** Nothing here returns a
 *    citation id or an adaptation type. A model saying "this scale was
 *    validated by Author X" is a sentence, not evidence, and §31 is explicit
 *    that provenance must never be invented.
 * 3. **Consequential fields are derived, never accepted.** `needsEvidence` in
 *    Phase 17B, and here: whether a hypothesis is traceable, whether an item is
 *    mapped, whether a construct is confirmed. The model proposes text.
 */
export class MethodologySuggestionError extends Error {
  constructor(
    message: string,
    /** Safe to show a researcher; never a raw provider error (§28). */
    public readonly userMessage: string,
  ) {
    super(message);
    this.name = "MethodologySuggestionError";
  }
}

/** Everything a proposal workflow returns. Nothing is persisted. */
export interface ProposalResult<T> {
  proposals: T[];
  /** Always `ai_suggested`. Callers persist this verbatim; they do not choose it. */
  provenance: "ai_suggested";
  /** Surfaced, never swallowed (§18). */
  contextTruncated: boolean;
  /** Things the workflow dropped or could not do, in researcher-readable words. */
  notes: string[];
}

const RESPONSE_TYPES = ["likert", "multiple_choice", "yes_no", "open_text", "numeric"] as const;
const CONSTRUCT_ROLES = [
  "independent", "dependent", "mediator", "moderator", "control", "demographic", "latent",
] as const;
const HYPOTHESIS_FORMS = [
  "association", "prediction", "difference", "mediation", "moderation", "descriptive", "unclassified",
] as const;
const POSITIONS = ["predictor", "outcome", "mediator", "moderator", "control"] as const;

/**
 * The one system-level framing every methodology prompt shares (§17: no
 * duplicated system instructions). The integrity guard already forbids invented
 * citations and results project-wide; this adds what is specific to methodology
 * work, and every line of it is a rule about authority rather than about style.
 */
const METHODOLOGY_FRAMING = [
  "You are proposing methodology options for a researcher to review. You are not deciding anything.",
  "",
  "- Never state that a study, instrument, sample size or hypothesis is valid, reliable, sufficient or proven.",
  "- Never claim a scale or item has been validated, or attribute one to a source. You have no source evidence here.",
  "- Only use ids from the candidate list given to you, exactly as written. If nothing fits, return an empty list.",
  "- If the information given is not enough to answer, say so in `note` and return fewer proposals.",
].join("\n");

async function propose<T>(params: {
  supabase: SupabaseClient;
  projectId: string;
  userId?: string;
  task: string;
  instruction: string;
  body: string;
  schema: z.ZodType<T>;
  jsonSchema: Record<string, unknown>;
}): Promise<T> {
  const project = await getProject(params.supabase, params.projectId);
  if (!project) throw new MethodologySuggestionError("project not found", "Project not found.");

  const orchestrator = new AIOrchestrator({ userId: params.userId, supabase: params.supabase });

  let response;
  try {
    response = await orchestrator.generate({
      projectId: params.projectId,
      taskType: "methodology",
      message: `${METHODOLOGY_FRAMING}\n\n${params.instruction}\n\n---\n${params.body}`,
      language: project.language,
      responseSchema: params.jsonSchema,
    });
  } catch {
    throw new MethodologySuggestionError(
      `${params.task} provider call failed`,
      `${params.task} could not run. Nothing was saved — you can retry.`,
    );
  }

  const parsed = parseAIJson({ raw: response.content, schema: params.schema, task: params.task });
  if (!parsed.ok) {
    // No repair, no partial acceptance: a half-parsed mapping is a mapping to
    // the wrong construct, which is worse than no mapping.
    throw new MethodologySuggestionError(
      `${params.task} response failed validation: ${parsed.reason}`,
      `${parsed.message} Nothing was saved — try again.`,
    );
  }
  return parsed.data;
}

/** Drops any id the model did not receive, and says how many it dropped. */
function keepKnownIds<T>(
  proposals: T[],
  pick: (p: T) => (string | null | undefined)[],
  known: Set<string>,
  notes: string[],
  what: string,
): T[] {
  const kept = proposals.filter((p) =>
    pick(p).every((id) => id === null || id === undefined || known.has(id)),
  );
  const dropped = proposals.length - kept.length;
  if (dropped > 0) {
    notes.push(
      `${dropped} ${what}${dropped === 1 ? "" : "s"} referred to something that is not in this project and ${dropped === 1 ? "was" : "were"} discarded.`,
    );
  }
  return kept;
}

// =====================================================================
// Map a questionnaire item to a construct / indicator (§16, §22)
// =====================================================================
const itemMappingSchema = z.object({
  mappings: z
    .array(
      z.object({
        constructId: z.string().nullable(),
        indicatorId: z.string().nullable(),
        confidence: z.enum(["high", "medium", "low"]),
        rationale: z.string(),
      }),
    )
    .max(10),
  note: z.string().optional(),
});

const ITEM_MAPPING_JSON_SCHEMA = {
  type: "object",
  properties: {
    mappings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          constructId: { type: ["string", "null"], description: "An id from the candidate list, or null." },
          indicatorId: { type: ["string", "null"], description: "An id from the candidate list, or null." },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
          rationale: { type: "string", description: "Why this item measures that, in one sentence." },
        },
        required: ["constructId", "indicatorId", "confidence", "rationale"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["mappings"],
  additionalProperties: false,
} as const;

export interface MappingProposal {
  constructId: string | null;
  indicatorId: string | null;
  /** The model's own confidence. Displayed; never treated as correctness (§8). */
  confidence: "high" | "medium" | "low";
  rationale: string;
}

export interface SuggestItemMappingParams {
  projectId: string;
  itemText: string;
  constructs: Candidate[];
  indicators: Candidate[];
  userId?: string;
}

export async function suggestItemMapping(
  supabase: SupabaseClient,
  params: SuggestItemMappingParams,
): Promise<ProposalResult<MappingProposal>> {
  const budget: ContextBudget = BUDGETS.itemMapping;
  const notes: string[] = [];

  const item = fitText(params.itemText, budget.maxTextChars);
  const constructs = fitCandidates(params.constructs, budget);
  const indicators = fitCandidates(params.indicators, budget);

  if (constructs.candidates.length === 0) {
    return {
      proposals: [],
      provenance: "ai_suggested",
      contextTruncated: false,
      notes: ["There are no constructs to map this item to yet."],
    };
  }
  if (constructs.truncated || indicators.truncated) {
    notes.push("Only the first candidates were considered — this project has more than the mapping step sends.");
  }

  const data = await propose({
    supabase,
    projectId: params.projectId,
    userId: params.userId,
    task: "item mapping",
    instruction: [
      "Which construct — and, if one fits, which indicator — does this questionnaire item measure?",
      "Return at most three options, best first. Return an empty list if none of the candidates fit.",
      "An indicator may only be paired with the construct it belongs to.",
    ].join("\n"),
    body: [
      `ITEM:\n${item.text}`,
      "",
      `CONSTRUCTS:\n${renderCandidates(constructs.candidates)}`,
      "",
      `INDICATORS:\n${renderCandidates(indicators.candidates)}`,
    ].join("\n"),
    schema: itemMappingSchema,
    jsonSchema: ITEM_MAPPING_JSON_SCHEMA as unknown as Record<string, unknown>,
  });

  if (data.note) notes.push(data.note);

  const known = new Set([
    ...constructs.candidates.map((c) => c.id),
    ...indicators.candidates.map((c) => c.id),
  ]);

  const kept = keepKnownIds(
    data.mappings,
    (m) => [m.constructId, m.indicatorId],
    known,
    notes,
    "suggested mapping",
  )
    // A mapping to nothing at all is not a proposal.
    .filter((m) => m.constructId || m.indicatorId)
    .slice(0, budget.maxProposals);

  return {
    proposals: kept,
    provenance: "ai_suggested",
    contextTruncated: item.truncated || constructs.truncated || indicators.truncated,
    notes,
  };
}

// =====================================================================
// Propose constructs from a research question (§7)
// =====================================================================
const constructSuggestionSchema = z.object({
  constructs: z
    .array(
      z.object({
        name: z.string().min(1),
        role: z.enum(CONSTRUCT_ROLES),
        conceptualDefinition: z.string(),
        rationale: z.string(),
      }),
    )
    .max(12),
  note: z.string().optional(),
});

const CONSTRUCT_SUGGESTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    constructs: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: { type: "string", enum: [...CONSTRUCT_ROLES] },
          conceptualDefinition: { type: "string", description: "What the concept means. No citation." },
          rationale: { type: "string", description: "Which words in the question this comes from." },
        },
        required: ["name", "role", "conceptualDefinition", "rationale"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["constructs"],
  additionalProperties: false,
} as const;

export interface ConstructProposal {
  name: string;
  role: ConstructRole;
  conceptualDefinition: string;
  rationale: string;
  /** True when a construct of that name already exists — shown, not filtered. */
  alreadyExists: boolean;
}

export async function suggestConstructs(
  supabase: SupabaseClient,
  params: { projectId: string; questionText: string; existingNames: string[]; userId?: string },
): Promise<ProposalResult<ConstructProposal>> {
  const budget = BUDGETS.constructSuggestion;
  const notes: string[] = [];
  const question = fitText(params.questionText, budget.maxTextChars);

  const data = await propose({
    supabase,
    projectId: params.projectId,
    userId: params.userId,
    task: "construct suggestion",
    instruction: [
      "Name the concepts this research question is about, and say what role each would play.",
      "Take them from the question's own wording. Do not add concepts the question does not raise.",
      "Give a plain conceptual definition for each. Do not attribute a definition to any author or source.",
    ].join("\n"),
    body: [
      `RESEARCH QUESTION:\n${question.text}`,
      "",
      `ALREADY IN THIS PROJECT:\n${params.existingNames.slice(0, budget.maxCandidates).join(", ") || "(none)"}`,
    ].join("\n"),
    schema: constructSuggestionSchema,
    jsonSchema: CONSTRUCT_SUGGESTION_JSON_SCHEMA as unknown as Record<string, unknown>,
  });

  if (data.note) notes.push(data.note);

  const existing = new Set(params.existingNames.map((n) => n.trim().toLowerCase()));

  return {
    proposals: data.constructs.slice(0, budget.maxProposals).map((c) => ({
      name: c.name.trim(),
      role: c.role as ConstructRole,
      conceptualDefinition: c.conceptualDefinition.trim(),
      rationale: c.rationale,
      // Shown rather than filtered: "you already have this" is useful
      // information, and silently dropping it looks like the model missed it.
      alreadyExists: existing.has(c.name.trim().toLowerCase()),
    })),
    provenance: "ai_suggested",
    contextTruncated: question.truncated,
    notes,
  };
}

// =====================================================================
// Propose hypotheses from a question and its constructs (§8)
// =====================================================================
const hypothesisSuggestionSchema = z.object({
  hypotheses: z
    .array(
      z.object({
        statement: z.string().min(1),
        form: z.enum(HYPOTHESIS_FORMS),
        variables: z
          .array(z.object({ constructId: z.string(), position: z.enum(POSITIONS) }))
          .max(6),
        rationale: z.string(),
      }),
    )
    .max(8),
  note: z.string().optional(),
});

const HYPOTHESIS_SUGGESTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    hypotheses: {
      type: "array",
      items: {
        type: "object",
        properties: {
          statement: { type: "string" },
          form: { type: "string", enum: [...HYPOTHESIS_FORMS] },
          variables: {
            type: "array",
            items: {
              type: "object",
              properties: {
                constructId: { type: "string", description: "An id from the candidate list." },
                position: { type: "string", enum: [...POSITIONS] },
              },
              required: ["constructId", "position"],
              additionalProperties: false,
            },
          },
          rationale: { type: "string" },
        },
        required: ["statement", "form", "variables", "rationale"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["hypotheses"],
  additionalProperties: false,
} as const;

export interface HypothesisProposal {
  statement: string;
  form: HypothesisForm;
  variables: { constructId: string; position: HypothesisPosition }[];
  rationale: string;
  /** Derived here, never taken from the model: a proposal with no outcome is
   *  incomplete whatever the model called it. */
  hasOutcome: boolean;
}

export async function suggestHypotheses(
  supabase: SupabaseClient,
  params: { projectId: string; questionText: string; constructs: Candidate[]; userId?: string },
): Promise<ProposalResult<HypothesisProposal>> {
  const budget = BUDGETS.hypothesisSuggestion;
  const notes: string[] = [];
  const question = fitText(params.questionText, budget.maxTextChars);
  const constructs = fitCandidates(params.constructs, budget);

  if (constructs.candidates.length < 2) {
    return {
      proposals: [],
      provenance: "ai_suggested",
      contextTruncated: false,
      notes: ["A hypothesis relates at least two constructs. Add more before asking for suggestions."],
    };
  }

  // The question's shape is computed here, not asked for: it decides which
  // hypotheses are even appropriate, and letting the model both choose the
  // shape and write to it removes the check.
  const shape = classifyQuestion(question.text);

  const data = await propose({
    supabase,
    projectId: params.projectId,
    userId: params.userId,
    task: "hypothesis suggestion",
    instruction: [
      "Draft hypotheses this research question could be tested with, using only the constructs listed.",
      "State each as one sentence. Do not state a direction unless the question itself implies one.",
      "Mark which construct is the predictor and which is the outcome. Every hypothesis needs an outcome.",
      shape.kind === "descriptive" || shape.kind === "exploratory"
        ? "This question reads as descriptive or exploratory. If it does not call for a hypothesis, return an empty list and say so in `note`."
        : "",
    ]
      .filter(Boolean)
      .join("\n"),
    body: [
      `RESEARCH QUESTION:\n${question.text}`,
      `QUESTION SHAPE (computed, not your judgement): ${shape.kind}`,
      "",
      `CONSTRUCTS:\n${renderCandidates(constructs.candidates)}`,
    ].join("\n"),
    schema: hypothesisSuggestionSchema,
    jsonSchema: HYPOTHESIS_SUGGESTION_JSON_SCHEMA as unknown as Record<string, unknown>,
  });

  if (data.note) notes.push(data.note);

  const known = new Set(constructs.candidates.map((c) => c.id));
  const kept = keepKnownIds(
    data.hypotheses,
    (h) => h.variables.map((v) => v.constructId),
    known,
    notes,
    "suggested hypothesis",
  ).slice(0, budget.maxProposals);

  return {
    proposals: kept.map((h) => ({
      statement: h.statement.trim(),
      form: h.form as HypothesisForm,
      variables: h.variables.map((v) => ({
        constructId: v.constructId,
        position: v.position as HypothesisPosition,
      })),
      rationale: h.rationale,
      hasOutcome: h.variables.some((v) => v.position === "outcome"),
    })),
    provenance: "ai_suggested",
    contextTruncated: question.truncated || constructs.truncated,
    notes,
  };
}

// =====================================================================
// Draft questionnaire items for an indicator (§30)
// =====================================================================
const itemGenerationSchema = z.object({
  items: z
    .array(
      z.object({
        text: z.string().min(1),
        responseType: z.enum(RESPONSE_TYPES),
        rationale: z.string(),
      }),
    )
    .max(12),
  note: z.string().optional(),
});

const ITEM_GENERATION_JSON_SCHEMA = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string", description: "The item, as a respondent would read it." },
          responseType: { type: "string", enum: [...RESPONSE_TYPES] },
          rationale: { type: "string", description: "Which part of the indicator this observes." },
        },
        required: ["text", "responseType", "rationale"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["items"],
  additionalProperties: false,
} as const;

export interface ItemProposal {
  text: string;
  responseType: QuestionResponseType;
  rationale: string;
  /** Always set by the caller from the request, never by the model (§30). */
  constructId: string | null;
  indicatorId: string | null;
}

export async function suggestItems(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    constructName: string;
    constructId: string | null;
    indicatorName?: string;
    indicatorId?: string | null;
    operationalDefinition?: string | null;
    existingItems?: string[];
    userId?: string;
  },
): Promise<ProposalResult<ItemProposal>> {
  const budget = BUDGETS.itemGeneration;
  const notes: string[] = [];
  const definition = fitText(params.operationalDefinition ?? "", budget.maxTextChars);
  const existing = (params.existingItems ?? []).slice(0, budget.maxCandidates);

  const data = await propose({
    supabase,
    projectId: params.projectId,
    userId: params.userId,
    task: "item generation",
    instruction: [
      "Draft questionnaire items that would observe the construct or indicator below.",
      "One idea per item. No two things joined by 'and'. No wording that signals a preferred answer.",
      "Do not repeat an item that already exists.",
      "Do not say any item comes from a published instrument — you have no source here.",
    ].join("\n"),
    body: [
      `CONSTRUCT: ${fitText(params.constructName, budget.maxCandidateChars).text}`,
      params.indicatorName ? `INDICATOR: ${fitText(params.indicatorName, budget.maxCandidateChars).text}` : "",
      definition.text ? `OPERATIONAL DEFINITION:\n${definition.text}` : "",
      "",
      `EXISTING ITEMS:\n${existing.length > 0 ? existing.map((t) => `- ${t}`).join("\n") : "(none)"}`,
    ]
      .filter(Boolean)
      .join("\n"),
    schema: itemGenerationSchema,
    jsonSchema: ITEM_GENERATION_JSON_SCHEMA as unknown as Record<string, unknown>,
  });

  if (data.note) notes.push(data.note);

  return {
    proposals: data.items.slice(0, budget.maxProposals).map((i) => ({
      text: i.text.trim(),
      responseType: i.responseType as QuestionResponseType,
      rationale: i.rationale,
      // The mapping comes from what was asked for, not from what the model
      // returned — there is no id in the response for it to get wrong.
      constructId: params.constructId,
      indicatorId: params.indicatorId ?? null,
    })),
    provenance: "ai_suggested",
    contextTruncated: definition.truncated || existing.length < (params.existingItems ?? []).length,
    notes,
  };
}

// =====================================================================
// Rewrite one item (§16) and draft an operational definition (§9)
// =====================================================================
const rewriteSchema = z.object({
  rewrites: z.array(z.object({ text: z.string().min(1), change: z.string() })).max(5),
  note: z.string().optional(),
});

const REWRITE_JSON_SCHEMA = {
  type: "object",
  properties: {
    rewrites: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          change: { type: "string", description: "What was changed and why, in one sentence." },
        },
        required: ["text", "change"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["rewrites"],
  additionalProperties: false,
} as const;

export interface RewriteProposal {
  text: string;
  change: string;
}

export async function suggestItemRewrite(
  supabase: SupabaseClient,
  params: { projectId: string; itemText: string; concerns?: string[]; userId?: string },
): Promise<ProposalResult<RewriteProposal>> {
  const budget = BUDGETS.itemRewrite;
  const item = fitText(params.itemText, budget.maxTextChars);
  const notes: string[] = [];

  const data = await propose({
    supabase,
    projectId: params.projectId,
    userId: params.userId,
    task: "item rewrite",
    instruction: [
      "Rewrite this questionnaire item so it asks about one thing, neutrally, in plain language.",
      "Keep what it is asking about. Do not broaden or narrow it.",
      "Give at most three alternatives and say what each one changed.",
    ].join("\n"),
    body: [
      `ITEM:\n${item.text}`,
      params.concerns?.length ? `\nCONCERNS RAISED BY THE CHECKS:\n${params.concerns.map((c) => `- ${c}`).join("\n")}` : "",
    ].join("\n"),
    schema: rewriteSchema,
    jsonSchema: REWRITE_JSON_SCHEMA as unknown as Record<string, unknown>,
  });

  if (data.note) notes.push(data.note);

  return {
    proposals: data.rewrites.slice(0, budget.maxProposals).map((r) => ({
      text: r.text.trim(),
      change: r.change,
    })),
    provenance: "ai_suggested",
    contextTruncated: item.truncated,
    notes,
  };
}

const definitionSchema = z.object({
  definitions: z.array(z.object({ text: z.string().min(1), rationale: z.string() })).max(5),
  note: z.string().optional(),
});

const DEFINITION_JSON_SCHEMA = {
  type: "object",
  properties: {
    definitions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["text", "rationale"],
        additionalProperties: false,
      },
    },
    note: { type: "string" },
  },
  required: ["definitions"],
  additionalProperties: false,
} as const;

export async function suggestOperationalDefinition(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    constructName: string;
    conceptualDefinition?: string | null;
    indicatorNames?: string[];
    userId?: string;
  },
): Promise<ProposalResult<RewriteProposal>> {
  const budget = BUDGETS.operationalDefinition;
  const conceptual = fitText(params.conceptualDefinition ?? "", budget.maxTextChars);
  const indicators = (params.indicatorNames ?? []).slice(0, budget.maxCandidates);
  const notes: string[] = [];

  const data = await propose({
    supabase,
    projectId: params.projectId,
    userId: params.userId,
    task: "operational definition",
    instruction: [
      "Write how this construct would be observed and scored in this study.",
      "Say what is measured and how a value is produced. Do not claim any procedure is validated.",
      "If the indicators given are not enough to observe the construct, say so in `note`.",
    ].join("\n"),
    body: [
      `CONSTRUCT: ${fitText(params.constructName, budget.maxCandidateChars).text}`,
      conceptual.text ? `CONCEPTUAL DEFINITION:\n${conceptual.text}` : "",
      "",
      `INDICATORS:\n${indicators.length > 0 ? indicators.map((n) => `- ${n}`).join("\n") : "(none yet)"}`,
    ]
      .filter(Boolean)
      .join("\n"),
    schema: definitionSchema,
    jsonSchema: DEFINITION_JSON_SCHEMA as unknown as Record<string, unknown>,
  });

  if (data.note) notes.push(data.note);

  return {
    proposals: data.definitions.slice(0, budget.maxProposals).map((d) => ({
      text: d.text.trim(),
      change: d.rationale,
    })),
    provenance: "ai_suggested",
    contextTruncated: conceptual.truncated || indicators.length < (params.indicatorNames ?? []).length,
    notes,
  };
}
