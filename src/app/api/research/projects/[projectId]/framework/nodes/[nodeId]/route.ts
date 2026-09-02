import { z } from "zod";
import { entityRoute } from "@/lib/api/methodology-crud";
import { deleteFrameworkNode, getFrameworkNode, updateFrameworkNode } from "@/lib/db/framework";
import { DbError } from "@/lib/db/errors";

/**
 * One conceptual-framework node.
 *
 * `constructId: null` is the unmap action and is a real edit, not a clear of
 * an optional field — §41 lists `framework_node_unlinked` as something that
 * has to stay auditable, and `entityRoute` records the before-value, so the
 * history shows which construct the node used to name.
 *
 * Moving a node writes position only. Coordinates are presentation data
 * (§10): no check, finding or metric reads them, so a drag cannot change what
 * the study claims.
 */
const patchSchema = z
  .object({
    constructId: z.string().uuid().nullable().optional(),
    label: z.string().trim().min(1).max(200).nullable().optional(),
    positionX: z.number().int().min(-100_000).max(100_000).optional(),
    positionY: z.number().int().min(-100_000).max(100_000).optional(),
    confirmed: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to update" });

export const { PATCH, DELETE } = entityRoute(
  {
    label: "framework node",
    entityType: "framework_node",
    key: "node",
    patchSchema,
    get: getFrameworkNode,
    update: async (supabase, projectId, id, input) => {
      const row = await updateFrameworkNode(supabase, projectId, id, {
        ...(input.constructId !== undefined ? { construct_id: input.constructId } : {}),
        ...(input.label !== undefined ? { label: input.label } : {}),
        ...(input.positionX !== undefined ? { position_x: input.positionX } : {}),
        ...(input.positionY !== undefined ? { position_y: input.positionY } : {}),
        ...(input.confirmed !== undefined ? { confirmed: input.confirmed } : {}),
      });
      // A project-scoped patch that matched nothing means the node is not the
      // caller's, or is gone. `entityRoute` turns notFound into a 404, which
      // is the same answer an unknown id gets — so a probe cannot tell a
      // stranger's node from one that never existed.
      if (!row) throw new DbError("Framework node not found", true);
      return row;
    },
    remove: async (supabase, projectId, id) => {
      await deleteFrameworkNode(supabase, projectId, id);
    },
    summary: (row) =>
      row.construct_id ? "Updated a framework node" : `Updated framework node: ${row.label}`,
  },
  "nodeId",
);
