import { z } from "zod";
import { entityRoute } from "@/lib/api/methodology-crud";
import { deleteIndicator, listIndicators, updateIndicator } from "@/lib/db/methodology";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    dimension: z.string().trim().max(200).nullable().optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    confirmed: z.boolean().optional(),
    orderIndex: z.number().int().min(0).max(999).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "Nothing to update" });

export const { PATCH, DELETE } = entityRoute(
  {
    label: "indicator",
    entityType: "indicator",
    key: "indicator",
    patchSchema,
    get: async (supabase, projectId, id) =>
      (await listIndicators(supabase, projectId)).find((i) => i.id === id) ?? null,
    update: (supabase, projectId, id, patch) =>
      updateIndicator(supabase, projectId, id, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.dimension !== undefined ? { dimension: patch.dimension } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.confirmed !== undefined ? { confirmed: patch.confirmed } : {}),
        ...(patch.orderIndex !== undefined ? { order_index: patch.orderIndex } : {}),
      }),
    remove: deleteIndicator,
    summary: (row) => `Updated indicator: ${row.name}`,
  },
  "indicatorId",
);
