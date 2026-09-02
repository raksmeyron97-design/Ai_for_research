import { z } from "zod";
import { collectionRoute } from "@/lib/api/methodology-crud";
import { createFrameworkNode, listFrameworkNodes } from "@/lib/db/framework";

/**
 * Conceptual-framework nodes (§6, §10).
 *
 * Built on the same `collectionRoute` the ten methodology entities use, so
 * the authorisation preamble, the Zod gate and the audit entry are the shared
 * ones rather than a twelfth copy that could drift.
 *
 * There is no server-side check that `constructId` belongs to this project,
 * and that is deliberate rather than an omission: the composite foreign key
 * `research_framework_nodes_construct_same_project` refuses it in the
 * database, which is the barrier a policy mistake cannot get past. The Phase
 * 20 isolation suite proves it with a real cross-project insert. Adding an
 * application check as well would read as the real defence and quietly become
 * the one people maintain.
 */
const createSchema = z
  .object({
    /** Null or absent means an unmapped node — legacy free text, or a box
     *  drawn before the construct behind it exists (§40). */
    constructId: z.string().uuid().nullable().optional(),
    label: z.string().trim().min(1).max(200).nullable().optional(),
    positionX: z.number().int().min(-100_000).max(100_000).optional(),
    positionY: z.number().int().min(-100_000).max(100_000).optional(),
    provenance: z.enum(["user", "ai_suggested", "source_stated", "imported"]).optional(),
    /** False for the accept-later flow, where AI proposals are kept for
     *  review rather than acted on one at a time (§11). */
    confirmed: z.boolean().optional(),
  })
  .refine((v) => v.constructId != null || (v.label != null && v.label.length > 0), {
    message: "A node needs either a construct or a label",
  });

export const { GET, POST } = collectionRoute({
  label: "framework nodes",
  entityType: "framework_node",
  key: "nodes",
  list: listFrameworkNodes,
  createSchema,
  create: (supabase, projectId, input) =>
    createFrameworkNode(supabase, {
      project_id: projectId,
      construct_id: input.constructId ?? null,
      label: input.label ?? null,
      position_x: input.positionX ?? 0,
      position_y: input.positionY ?? 0,
      provenance: input.provenance ?? "user",
      confirmed: input.confirmed ?? true,
    }),
  summary: (row) =>
    row.construct_id
      ? `Added a framework node for a construct`
      : `Added framework node: ${row.label}`,
});
