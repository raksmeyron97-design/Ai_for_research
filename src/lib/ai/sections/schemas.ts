import { z } from "zod";

/**
 * Structured output schemas for the section generators.
 *
 * Written for OpenAI's `strict: true` json_schema mode, the same convention
 * as `src/lib/ai/schemas.ts`: every property required, `additionalProperties:
 * false`, and "no value" expressed as `""` or `[]` rather than null or an
 * omitted key. The Zod schema is the validation authority; the JSON Schema is
 * what the provider is asked to honour.
 *
 * These never carry a default or a repaired value. A response that does not
 * validate is a failure the caller handles — `parse-ai-json.ts` guarantees no
 * partially populated object reaches application state (§7).
 */

const nonEmpty = z.string().min(1);

// ---------------------------------------------------------------------
// Objectives (§8)
// ---------------------------------------------------------------------

/**
 * `measurable` and `measurabilityNote` are the model's own assessment of the
 * objective it just wrote. Asking for it in the same response is cheaper than
 * a second call and, more usefully, forces the model to commit to a claim the
 * researcher can disagree with.
 */
export const objectivesResponseSchema = z.object({
  generalObjective: nonEmpty,
  specificObjectives: z
    .array(
      z.object({
        text: nonEmpty,
        measurable: z.boolean(),
        measurabilityNote: z.string(),
        /** Which research question this answers, or "" if none exists yet. */
        linkedQuestion: z.string(),
      }),
    )
    .min(1),
  /** Misalignments the model noticed against the context it was given. */
  alignmentNotes: z.array(z.string()),
});
export type ObjectivesResponse = z.infer<typeof objectivesResponseSchema>;

export const OBJECTIVES_JSON_SCHEMA = {
  type: "object",
  properties: {
    generalObjective: { type: "string" },
    specificObjectives: {
      type: "array",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          measurable: { type: "boolean" },
          measurabilityNote: { type: "string", description: "Why it is or is not measurable; \"\" if obvious." },
          linkedQuestion: { type: "string", description: "Matching research question, or \"\"." },
        },
        required: ["text", "measurable", "measurabilityNote", "linkedQuestion"],
        additionalProperties: false,
      },
    },
    alignmentNotes: { type: "array", items: { type: "string" } },
  },
  required: ["generalObjective", "specificObjectives", "alignmentNotes"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------
// Research questions (§9)
// ---------------------------------------------------------------------

export const researchQuestionsResponseSchema = z.object({
  questions: z
    .array(
      z.object({
        question: nonEmpty,
        /** The objective this question answers, or "" when it maps to none — which is itself a finding. */
        objective: z.string(),
        /** Variable the question measures, or "". */
        variable: z.string(),
      }),
    )
    .min(1),
  /** Objectives with no question, questions with no objective, duplicates. */
  issues: z.array(
    z.object({
      kind: z.enum(["duplicate_question", "question_without_objective", "objective_without_question"]),
      detail: nonEmpty,
    }),
  ),
});
export type ResearchQuestionsResponse = z.infer<typeof researchQuestionsResponseSchema>;

export const RESEARCH_QUESTIONS_JSON_SCHEMA = {
  type: "object",
  properties: {
    questions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          objective: { type: "string", description: "Objective this answers, or \"\"." },
          variable: { type: "string", description: "Variable measured, or \"\"." },
        },
        required: ["question", "objective", "variable"],
        additionalProperties: false,
      },
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: {
            type: "string",
            enum: ["duplicate_question", "question_without_objective", "objective_without_question"],
          },
          detail: { type: "string" },
        },
        required: ["kind", "detail"],
        additionalProperties: false,
      },
    },
  },
  required: ["questions", "issues"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------
// Variables (§10)
// ---------------------------------------------------------------------

/**
 * Every generated variable is `ai_suggested`. The model is not permitted to
 * emit a confirmation status at all — confirmation is a researcher action,
 * recorded by the application, and a model that could write "confirmed" would
 * eventually write it (§10: never silently save an AI suggestion as
 * confirmed).
 */
export const variablesResponseSchema = z.object({
  variables: z
    .array(
      z.object({
        name: nonEmpty,
        role: z.enum(["independent", "dependent", "confounder", "mediator", "covariate"]),
        dataType: z.enum(["categorical", "ordinal", "continuous", "binary", "count"]),
        operationalDefinition: nonEmpty,
        measurement: z.string(),
        linkedObjective: z.string(),
      }),
    )
    .min(1),
  notes: z.array(z.string()),
});
export type VariablesResponse = z.infer<typeof variablesResponseSchema>;

export const VARIABLES_JSON_SCHEMA = {
  type: "object",
  properties: {
    variables: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          role: {
            type: "string",
            enum: ["independent", "dependent", "confounder", "mediator", "covariate"],
          },
          dataType: { type: "string", enum: ["categorical", "ordinal", "continuous", "binary", "count"] },
          operationalDefinition: { type: "string", description: "How it is defined and measured in practice." },
          measurement: { type: "string", description: "Instrument, scale or unit; \"\" if not yet decided." },
          linkedObjective: { type: "string", description: "Objective this serves, or \"\"." },
        },
        required: ["name", "role", "dataType", "operationalDefinition", "measurement", "linkedObjective"],
        additionalProperties: false,
      },
    },
    notes: { type: "array", items: { type: "string" } },
  },
  required: ["variables", "notes"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------
// Methodology review (§11)
// ---------------------------------------------------------------------

export const METHODOLOGY_ASPECTS = [
  "study_design",
  "study_population",
  "setting",
  "inclusion_criteria",
  "exclusion_criteria",
  "sampling",
  "sample_size",
  "instrument",
  "data_collection",
  "analysis",
  "ethics",
] as const;

export const methodologyReviewResponseSchema = z.object({
  findings: z
    .array(
      z.object({
        aspect: z.enum(METHODOLOGY_ASPECTS),
        verdict: z.enum(["PASS", "WARN", "NEEDS_CLARIFICATION", "INCONSISTENT"]),
        issue: z.string(),
        reason: z.string(),
        affectedSection: z.string(),
        recommendation: z.string(),
      }),
    )
    .min(1),
});
export type MethodologyReviewResponse = z.infer<typeof methodologyReviewResponseSchema>;

export const METHODOLOGY_REVIEW_JSON_SCHEMA = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        properties: {
          aspect: { type: "string", enum: [...METHODOLOGY_ASPECTS] },
          verdict: { type: "string", enum: ["PASS", "WARN", "NEEDS_CLARIFICATION", "INCONSISTENT"] },
          issue: { type: "string", description: "What is wrong; \"\" when the verdict is PASS." },
          reason: { type: "string", description: "Why it matters methodologically." },
          affectedSection: { type: "string", description: "Section this concerns, or \"\"." },
          recommendation: { type: "string", description: "Concrete fix, or \"\"." },
        },
        required: ["aspect", "verdict", "issue", "reason", "affectedSection", "recommendation"],
        additionalProperties: false,
      },
    },
  },
  required: ["findings"],
  additionalProperties: false,
};

// ---------------------------------------------------------------------
// Sampling plan (§12)
// ---------------------------------------------------------------------

/**
 * `MISSING_INPUT` is a first-class value, not an error. §12 forbids inventing
 * a population count, so a plan that cannot be completed must say which input
 * it lacks rather than filling the gap with a plausible number.
 */
export const samplingPlanResponseSchema = z.object({
  populationDefinition: z.string(),
  samplingStrategy: z.string(),
  inclusionCriteria: z.array(z.string()),
  exclusionCriteria: z.array(z.string()),
  sampleSizeExplanation: z.string(),
  /** Inputs a sample-size calculation needs that the researcher has not supplied. */
  missingInputs: z.array(z.string()),
});
export type SamplingPlanResponse = z.infer<typeof samplingPlanResponseSchema>;

export const SAMPLING_PLAN_JSON_SCHEMA = {
  type: "object",
  properties: {
    populationDefinition: { type: "string" },
    samplingStrategy: { type: "string" },
    inclusionCriteria: { type: "array", items: { type: "string" } },
    exclusionCriteria: { type: "array", items: { type: "string" } },
    sampleSizeExplanation: {
      type: "string",
      description:
        "Explain the formula and its assumptions. Never state a population count that was not supplied — list it under missingInputs instead.",
    },
    missingInputs: { type: "array", items: { type: "string" } },
  },
  required: [
    "populationDefinition",
    "samplingStrategy",
    "inclusionCriteria",
    "exclusionCriteria",
    "sampleSizeExplanation",
    "missingInputs",
  ],
  additionalProperties: false,
};

// ---------------------------------------------------------------------
// Conceptual framework (§13)
// ---------------------------------------------------------------------

export const conceptualFrameworkResponseSchema = z.object({
  population: z.string(),
  independentVariables: z.array(z.string()),
  mediatingVariables: z.array(z.string()),
  outcomeVariables: z.array(z.string()),
  /** Every relationship is AI-suggested until the researcher confirms it (§13). */
  relationships: z.array(
    z.object({ from: nonEmpty, to: nonEmpty, rationale: z.string() }),
  ),
});
export type ConceptualFrameworkResponse = z.infer<typeof conceptualFrameworkResponseSchema>;

export const CONCEPTUAL_FRAMEWORK_JSON_SCHEMA = {
  type: "object",
  properties: {
    population: { type: "string" },
    independentVariables: { type: "array", items: { type: "string" } },
    mediatingVariables: { type: "array", items: { type: "string" } },
    outcomeVariables: { type: "array", items: { type: "string" } },
    relationships: {
      type: "array",
      items: {
        type: "object",
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          rationale: { type: "string" },
        },
        required: ["from", "to", "rationale"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "population",
    "independentVariables",
    "mediatingVariables",
    "outcomeVariables",
    "relationships",
  ],
  additionalProperties: false,
};
