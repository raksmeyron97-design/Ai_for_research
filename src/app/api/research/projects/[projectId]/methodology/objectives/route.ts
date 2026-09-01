import { z } from "zod";
import { collectionRoute } from "@/lib/api/methodology-crud";
import { createObjective, listObjectives } from "@/lib/db/methodology";

const createSchema = z.object({
  objectiveText: z.string().trim().min(1).max(1000),
  /** Verified by the composite foreign key, not by trusting the body (§27). */
  questionId: z.string().uuid().nullable().optional(),
  provenance: z.enum(["user", "ai_suggested", "imported"]).optional(),
  orderIndex: z.number().int().min(0).max(999).optional(),
});

export const { GET, POST } = collectionRoute({
  label: "objectives",
  entityType: "objective",
  key: "objectives",
  list: listObjectives,
  createSchema,
  create: (supabase, projectId, input) =>
    createObjective(supabase, {
      project_id: projectId,
      objective_text: input.objectiveText,
      question_id: input.questionId ?? null,
      provenance: input.provenance ?? "user",
      confirmed: true,
      order_index: input.orderIndex ?? 0,
    }),
  summary: (row) => `Added objective: ${row.objective_text.slice(0, 120)}`,
});
