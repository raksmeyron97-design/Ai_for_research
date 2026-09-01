import { z } from "zod";

/**
 * Hand-written JSON Schema (sent to the provider) plus a matching Zod
 * schema (used to validate the parsed response) for each structured AI
 * call in the Research Intelligence layer. Duplicated by hand rather than
 * derived from one definition — this project has no zod-to-json-schema
 * dependency, and these two schemas are small and stable enough that
 * keeping them in sync manually is simpler than adding one. Written for
 * OpenAI's `strict: true` json_schema mode: every property is required
 * (no `?`), `additionalProperties: false` throughout, "no value" is
 * represented as `""`/`[]`, not `null`/omitted.
 */

const ISSUE_JSON_SCHEMA = {
  type: "object",
  properties: {
    severity: { type: "string", enum: ["critical", "high", "medium", "low", "informational"] },
    category: { type: "string" },
    section: { type: "string", description: "Section type this issue concerns, or \"\" if project-wide." },
    message: { type: "string" },
    recommendation: { type: "string", description: "Concrete fix, or \"\" if none." },
  },
  required: ["severity", "category", "section", "message", "recommendation"],
  additionalProperties: false,
};

export const ALIGNMENT_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    issues: { type: "array", items: ISSUE_JSON_SCHEMA },
  },
  required: ["issues"],
  additionalProperties: false,
};

const issueSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low", "informational"]),
  category: z.string(),
  section: z.string(),
  message: z.string(),
  recommendation: z.string(),
});

export const alignmentResponseSchema = z.object({
  issues: z.array(issueSchema),
});

export type AlignmentResponse = z.infer<typeof alignmentResponseSchema>;

const SCORE_FIELD = { type: "number", description: "0-100" } as const;

export const QUALITY_CHECK_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    scores: {
      type: "object",
      properties: {
        methodology: SCORE_FIELD,
        evidence: SCORE_FIELD,
        alignment: SCORE_FIELD,
        writing: SCORE_FIELD,
        references: SCORE_FIELD,
        dataIntegrity: SCORE_FIELD,
        overall: SCORE_FIELD,
      },
      required: ["methodology", "evidence", "alignment", "writing", "references", "dataIntegrity", "overall"],
      additionalProperties: false,
    },
    issues: { type: "array", items: ISSUE_JSON_SCHEMA },
  },
  required: ["scores", "issues"],
  additionalProperties: false,
};

const scoreSchema = z.number().min(0).max(100);

export const qualityCheckResponseSchema = z.object({
  scores: z.object({
    methodology: scoreSchema,
    evidence: scoreSchema,
    alignment: scoreSchema,
    writing: scoreSchema,
    references: scoreSchema,
    dataIntegrity: scoreSchema,
    overall: scoreSchema,
  }),
  issues: z.array(issueSchema),
});

export type QualityCheckResponse = z.infer<typeof qualityCheckResponseSchema>;

// ---------------------------------------------------------------------
// Questionnaire generation (Phase 6, spec §25-26)
// ---------------------------------------------------------------------

const QUESTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    objective_label: { type: "string", description: "Which objective this measures, or \"\" if none." },
    variable_label: { type: "string", description: "Which variable this measures, or \"\" if none." },
    construct: { type: "string", description: "e.g. \"screening_knowledge\", or \"\" if none." },
    question_text: { type: "string" },
    response_type: { type: "string", enum: ["likert", "multiple_choice", "yes_no", "open_text", "numeric"] },
    options: {
      type: "array",
      items: { type: "string" },
      description: "Answer choices for likert/multiple_choice; [] otherwise.",
    },
    required: { type: "boolean" },
  },
  required: ["objective_label", "variable_label", "construct", "question_text", "response_type", "options", "required"],
  additionalProperties: false,
};

const SECTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    section_label: { type: "string", description: "e.g. Demographics, Knowledge, Attitude, Practice, Barriers." },
    questions: { type: "array", items: QUESTION_JSON_SCHEMA },
  },
  required: ["section_label", "questions"],
  additionalProperties: false,
};

export const QUESTIONNAIRE_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    instrument: {
      type: "object",
      properties: {
        name: { type: "string" },
        validation_status: { type: "string", enum: ["validated", "adapted", "researcher_developed"] },
        source_reference: {
          type: "string",
          description: "Required (non-empty) unless validation_status is researcher_developed; \"\" otherwise.",
        },
        adaptation_notes: { type: "string", description: "\"\" if not adapted from an existing instrument." },
      },
      required: ["name", "validation_status", "source_reference", "adaptation_notes"],
      additionalProperties: false,
    },
    sections: { type: "array", items: SECTION_JSON_SCHEMA },
  },
  required: ["instrument", "sections"],
  additionalProperties: false,
};

const questionSchema = z.object({
  objective_label: z.string(),
  variable_label: z.string(),
  construct: z.string(),
  question_text: z.string().min(1),
  response_type: z.enum(["likert", "multiple_choice", "yes_no", "open_text", "numeric"]),
  options: z.array(z.string()),
  required: z.boolean(),
});

const instrumentSchema = z
  .object({
    name: z.string().min(1),
    validation_status: z.enum(["validated", "adapted", "researcher_developed"]),
    source_reference: z.string(),
    adaptation_notes: z.string(),
  })
  // Mirrors the DB CHECK constraint (source_reference_required_unless_researcher_developed)
  // at the point the AI response is parsed, so a violation is caught
  // before it ever reaches an insert — not relying on the DB constraint
  // as the only backstop.
  .refine((instrument) => instrument.validation_status === "researcher_developed" || instrument.source_reference.trim().length > 0, {
    message: "source_reference is required unless validation_status is researcher_developed",
    path: ["source_reference"],
  });

export const questionnaireResponseSchema = z.object({
  instrument: instrumentSchema,
  sections: z.array(
    z.object({
      section_label: z.string().min(1),
      questions: z.array(questionSchema),
    }),
  ),
});

export type QuestionnaireResponse = z.infer<typeof questionnaireResponseSchema>;
