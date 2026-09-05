import { z } from "zod";
import { entityRoute } from "@/lib/api/methodology-crud";
import { deleteFrameworkRelationship, updateFrameworkRelationship } from "@/lib/db/framework";
import { DbError } from "@/lib/db/errors";
import { FRAMEWORK_RELATION_LABELS } from "@/lib/db/types";

/**
 * One conceptual-framework relationship.
 *
 * The endpoints are not patchable. Changing what a relationship connects is
 * not an edit of that relationship, it is a different claim about the study —
 * and leaving it as delete-then-create keeps both events in the audit trail
 * instead of collapsing them into one "updated" line that loses what the
 * relationship used to say.
 */
const RELATION_TYPES = Object.keys(FRAMEWORK_RELATION_LABELS) as [
  keyof typeof FRAMEWORK_RELATION_LABELS,
  ...(keyof typeof FRAMEWORK_RELATION_LABELS)[],
];

const patchSchema = z
  .object({
    relationType: z.enum(RELATION_TYPES).optional(),
    hypothesisId: z.string().uuid().nullable().optional(),
    rationale: z.string().trim().max(2000).nullable().optional(),
    confirmed: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export const { PATCH, DELETE } = entityRoute(
  {
    label: "framework relationship",
    entityType: "framework_relationship",
    key: "relationship",
    patchSchema,
    update: async (supabase, projectId, id, input) => {
      const row = await updateFrameworkRelationship(supabase, projectId, id, {
        ...(input.relationType !== undefined ? { relation_type: input.relationType } : {}),
        ...(input.hypothesisId !== undefined ? { hypothesis_id: input.hypothesisId } : {}),
        ...(input.rationale !== undefined ? { rationale: input.rationale } : {}),
        ...(input.confirmed !== undefined ? { confirmed: input.confirmed } : {}),
      });
      if (!row) throw new DbError("Framework relationship not found", true);
      return row;
    },
    remove: async (supabase, projectId, id) => {
      await deleteFrameworkRelationship(supabase, projectId, id);
    },
    summary: (row) => `Updated a framework relationship (${row.relation_type})`,
  },
  "relationshipId",
);
