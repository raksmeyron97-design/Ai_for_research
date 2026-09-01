import { z } from "zod";
import { entityRoute } from "@/lib/api/methodology-crud";
import { deleteObjective, listObjectives, updateObjective } from "@/lib/db/methodology";

const patchSchema = z
  .object({
    objectiveText: z.string().trim().min(1).max(1000).optional(),
    questionId: z.string().uuid().nullable().optional(),
    orderIndex: z.number().int().min(0).max(999).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "Nothing to update" });

export const { PATCH, DELETE } = entityRoute(
  {
    label: "objective",
    entityType: "objective",
    key: "objective",
    patchSchema,
    get: async (supabase, projectId, id) =>
      (await listObjectives(supabase, projectId)).find((o) => o.id === id) ?? null,
    update: (supabase, projectId, id, patch) =>
      updateObjective(supabase, projectId, id, {
        ...(patch.objectiveText !== undefined ? { objective_text: patch.objectiveText } : {}),
        ...(patch.questionId !== undefined ? { question_id: patch.questionId } : {}),
        ...(patch.orderIndex !== undefined ? { order_index: patch.orderIndex } : {}),
      }),
    remove: deleteObjective,
    summary: (row) => `Updated objective: ${row.objective_text.slice(0, 120)}`,
  },
  "objectiveId",
);
