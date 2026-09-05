import { z } from "zod";
import { collectionRoute } from "@/lib/api/methodology-crud";
import { createFrameworkRelationship, listFrameworkRelationships } from "@/lib/db/framework";
import { FRAMEWORK_RELATION_LABELS } from "@/lib/db/types";

/**
 * Conceptual-framework relationships (§7).
 *
 * The relation vocabulary is closed and comes from the same constant the
 * database check constraint mirrors, so a value this schema accepts is a value
 * the table accepts. The endpoints, and the optional hypothesis, are refused
 * across projects by composite foreign keys — the Phase 20 isolation suite
 * attempts all three.
 *
 * Self-loops and duplicate edges are refused by the database too, so they are
 * not re-validated here. A researcher gets a plain 500-style message for
 * those rather than a field error, which is the one rough edge of letting the
 * constraint be the rule; it is the right trade while the alternative is a
 * second copy of the rule that can disagree with the first.
 */
const RELATION_TYPES = Object.keys(FRAMEWORK_RELATION_LABELS) as [
  keyof typeof FRAMEWORK_RELATION_LABELS,
  ...(keyof typeof FRAMEWORK_RELATION_LABELS)[],
];

const createSchema = z.object({
  fromNodeId: z.string().uuid(),
  toNodeId: z.string().uuid(),
  relationType: z.enum(RELATION_TYPES).optional(),
  /** Belongs to the relationship, not to either node: a hypothesis is a
   *  statement about a pair of constructs. */
  hypothesisId: z.string().uuid().nullable().optional(),
  rationale: z.string().trim().max(2000).nullable().optional(),
  provenance: z.enum(["user", "ai_suggested", "source_stated", "imported"]).optional(),
  confirmed: z.boolean().optional(),
});

export const { GET, POST } = collectionRoute({
  label: "framework relationships",
  entityType: "framework_relationship",
  key: "relationships",
  list: listFrameworkRelationships,
  createSchema,
  create: (supabase, projectId, input) =>
    createFrameworkRelationship(supabase, {
      project_id: projectId,
      from_node_id: input.fromNodeId,
      to_node_id: input.toNodeId,
      relation_type: input.relationType ?? "associated_with",
      hypothesis_id: input.hypothesisId ?? null,
      rationale: input.rationale ?? null,
      provenance: input.provenance ?? "user",
      confirmed: input.confirmed ?? true,
    }),
  summary: (row) => `Added a framework relationship (${row.relation_type})`,
});
