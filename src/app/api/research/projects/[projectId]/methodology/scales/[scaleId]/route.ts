import { z } from "zod";
import { entityRoute } from "@/lib/api/methodology-crud";
import { deleteScale, listScales, updateScale } from "@/lib/db/methodology";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    points: z
      .array(z.object({ value: z.number().int().min(-100).max(100), label: z.string().trim().min(1).max(120) }))
      .min(2)
      .max(11)
      .optional(),
    polarity: z.enum(["ascending", "descending", "unordered"]).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "Nothing to update" });

export const { PATCH, DELETE } = entityRoute(
  {
    label: "response scale",
    entityType: "scale",
    key: "scale",
    patchSchema,
    get: async (supabase, projectId, id) =>
      (await listScales(supabase, projectId)).find((s) => s.id === id) ?? null,
    update: (supabase, projectId, id, patch) => updateScale(supabase, projectId, id, patch),
    remove: deleteScale,
    summary: (row) => `Updated response scale: ${row.name}`,
  },
  "scaleId",
);
