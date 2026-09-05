import { z } from "zod";
import { entityRoute } from "@/lib/api/methodology-crud";
import { deleteConstruct, getConstruct, updateConstruct } from "@/lib/db/methodology";

const patchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    role: z
      .enum(["independent", "dependent", "mediator", "moderator", "control", "demographic", "latent"])
      .optional(),
    conceptualDefinition: z.string().trim().max(4000).nullable().optional(),
    operationalDefinition: z.string().trim().max(4000).nullable().optional(),
    notes: z.string().trim().max(4000).nullable().optional(),
    /** The researcher accepting a suggestion. Provenance itself is immutable. */
    confirmed: z.boolean().optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "Nothing to update" });

export const { PATCH, DELETE } = entityRoute(
  {
    label: "construct",
    entityType: "construct",
    key: "construct",
    patchSchema,
    get: getConstruct,
    update: (supabase, projectId, id, patch) =>
      updateConstruct(supabase, projectId, id, {
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.role !== undefined ? { role: patch.role } : {}),
        ...(patch.conceptualDefinition !== undefined
          ? { conceptual_definition: patch.conceptualDefinition }
          : {}),
        ...(patch.operationalDefinition !== undefined
          ? { operational_definition: patch.operationalDefinition }
          : {}),
        ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
        ...(patch.confirmed !== undefined ? { confirmed: patch.confirmed } : {}),
      }),
    remove: deleteConstruct,
    summary: (row) => `Updated construct: ${row.name}`,
  },
  "constructId",
);
