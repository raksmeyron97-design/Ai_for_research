import { z } from "zod";
import { collectionRoute } from "@/lib/api/methodology-crud";
import { createHypothesis, listHypotheses } from "@/lib/db/methodology";

const createSchema = z.object({
  statement: z.string().trim().min(1).max(1000),
  label: z.string().trim().max(20).nullable().optional(),
  hypothesisForm: z
    .enum(["association", "prediction", "difference", "mediation", "moderation", "descriptive", "unclassified"])
    .optional(),
  /**
   * Only what the researcher stated. `unspecified` is the default and is not a
   * gap — "X is associated with Y" states no direction, and defaulting to one
   * would put a prediction in the study that nobody made.
   */
  direction: z.enum(["positive", "negative", "none", "unspecified"]).optional(),
  analysisMethod: z.string().trim().max(500).nullable().optional(),
  objectiveId: z.string().uuid().nullable().optional(),
  questionId: z.string().uuid().nullable().optional(),
  provenance: z.enum(["user", "ai_suggested", "imported"]).optional(),
  orderIndex: z.number().int().min(0).max(999).optional(),
});

export const { GET, POST } = collectionRoute({
  label: "hypotheses",
  entityType: "hypothesis",
  key: "hypotheses",
  list: listHypotheses,
  createSchema,
  create: (supabase, projectId, input) =>
    createHypothesis(supabase, {
      project_id: projectId,
      statement: input.statement,
      label: input.label ?? null,
      hypothesis_form: input.hypothesisForm ?? "unclassified",
      direction: input.direction ?? "unspecified",
      analysis_method: input.analysisMethod ?? null,
      objective_id: input.objectiveId ?? null,
      question_id: input.questionId ?? null,
      provenance: input.provenance ?? "user",
      confirmed: true,
      order_index: input.orderIndex ?? 0,
    }),
  summary: (row) => `Added hypothesis${row.label ? ` ${row.label}` : ""}: ${row.statement.slice(0, 120)}`,
});
