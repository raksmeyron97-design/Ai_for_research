import { z } from "zod";
import { collectionRoute } from "@/lib/api/methodology-crud";
import { createScale, listScales } from "@/lib/db/methodology";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** Two points minimum: a "scale" with one option is not a scale. */
  points: z
    .array(z.object({ value: z.number().int().min(-100).max(100), label: z.string().trim().min(1).max(120) }))
    .min(2)
    .max(11),
  polarity: z.enum(["ascending", "descending", "unordered"]).optional(),
});

export const { GET, POST } = collectionRoute({
  label: "response scales",
  entityType: "scale",
  key: "scales",
  list: listScales,
  createSchema,
  create: (supabase, projectId, input) =>
    createScale(supabase, {
      project_id: projectId,
      name: input.name,
      points: input.points,
      polarity: input.polarity ?? "ascending",
    }),
  summary: (row) => `Added response scale: ${row.name}`,
});
