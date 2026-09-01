import { z } from "zod";
import { collectionRoute } from "@/lib/api/methodology-crud";
import { createConstruct, listConstructs } from "@/lib/db/methodology";

const ROLES = [
  "independent", "dependent", "mediator", "moderator", "control", "demographic", "latent",
] as const;

const createSchema = z.object({
  name: z.string().trim().min(1).max(200),
  role: z.enum(ROLES).optional(),
  conceptualDefinition: z.string().trim().max(4000).nullable().optional(),
  operationalDefinition: z.string().trim().max(4000).nullable().optional(),
  notes: z.string().trim().max(4000).nullable().optional(),
  provenance: z.enum(["user", "ai_suggested", "source_stated", "imported"]).optional(),
  /**
   * A row created from an AI suggestion is confirmed by default, because
   * creating it *is* the researcher's decision. `confirmed: false` exists for
   * the accept-later flow, where a batch of suggestions is kept for review.
   */
  confirmed: z.boolean().optional(),
});

export const { GET, POST } = collectionRoute({
  label: "constructs",
  entityType: "construct",
  key: "constructs",
  list: listConstructs,
  createSchema,
  create: (supabase, projectId, input) =>
    createConstruct(supabase, {
      project_id: projectId,
      name: input.name,
      role: input.role ?? "latent",
      conceptual_definition: input.conceptualDefinition ?? null,
      operational_definition: input.operationalDefinition ?? null,
      notes: input.notes ?? null,
      provenance: input.provenance ?? "user",
      confirmed: input.confirmed ?? true,
    }),
  summary: (row) => `Added construct: ${row.name}`,
});
