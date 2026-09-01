import { z } from "zod";
import { collectionRoute } from "@/lib/api/methodology-crud";
import { createIndicator, listIndicators } from "@/lib/db/methodology";

const createSchema = z.object({
  /** Verified by the composite foreign key: a construct from another project fails there. */
  constructId: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  dimension: z.string().trim().max(200).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  provenance: z.enum(["user", "ai_suggested", "source_stated", "imported"]).optional(),
  orderIndex: z.number().int().min(0).max(999).optional(),
});

export const { GET, POST } = collectionRoute({
  label: "indicators",
  entityType: "indicator",
  key: "indicators",
  list: listIndicators,
  createSchema,
  create: (supabase, projectId, input) =>
    createIndicator(supabase, {
      project_id: projectId,
      construct_id: input.constructId,
      name: input.name,
      dimension: input.dimension ?? null,
      description: input.description ?? null,
      provenance: input.provenance ?? "user",
      confirmed: true,
      order_index: input.orderIndex ?? 0,
    }),
  summary: (row) => `Added indicator: ${row.name}`,
});
