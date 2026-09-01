import { z } from "zod";
import { entityRoute } from "@/lib/api/methodology-crud";
import { deleteHypothesis, listHypotheses, updateHypothesis } from "@/lib/db/methodology";

const patchSchema = z
  .object({
    statement: z.string().trim().min(1).max(1000).optional(),
    label: z.string().trim().max(20).nullable().optional(),
    hypothesisForm: z
      .enum(["association", "prediction", "difference", "mediation", "moderation", "descriptive", "unclassified"])
      .optional(),
    direction: z.enum(["positive", "negative", "none", "unspecified"]).optional(),
    analysisMethod: z.string().trim().max(500).nullable().optional(),
    objectiveId: z.string().uuid().nullable().optional(),
    questionId: z.string().uuid().nullable().optional(),
    confirmed: z.boolean().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "Nothing to update" });

export const { PATCH, DELETE } = entityRoute(
  {
    label: "hypothesis",
    entityType: "hypothesis",
    key: "hypothesis",
    patchSchema,
    get: async (supabase, projectId, id) =>
      (await listHypotheses(supabase, projectId)).find((h) => h.id === id) ?? null,
    update: (supabase, projectId, id, patch) =>
      updateHypothesis(supabase, projectId, id, {
        ...(patch.statement !== undefined ? { statement: patch.statement } : {}),
        ...(patch.label !== undefined ? { label: patch.label } : {}),
        ...(patch.hypothesisForm !== undefined ? { hypothesis_form: patch.hypothesisForm } : {}),
        ...(patch.direction !== undefined ? { direction: patch.direction } : {}),
        ...(patch.analysisMethod !== undefined ? { analysis_method: patch.analysisMethod } : {}),
        ...(patch.objectiveId !== undefined ? { objective_id: patch.objectiveId } : {}),
        ...(patch.questionId !== undefined ? { question_id: patch.questionId } : {}),
        ...(patch.confirmed !== undefined ? { confirmed: patch.confirmed } : {}),
      }),
    remove: deleteHypothesis,
    summary: (row) => `Updated hypothesis${row.label ? ` ${row.label}` : ""}: ${row.statement.slice(0, 120)}`,
  },
  "hypothesisId",
);
