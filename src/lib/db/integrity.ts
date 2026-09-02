import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError } from "./errors";
import type {
  ResearchClaimMethodologyLinkInsert,
  ResearchClaimMethodologyLinkRow,
  ResearchIntegrityDecisionInsert,
  ResearchIntegrityDecisionRow,
  ResearchIntegrityDecisionUpdate,
  ResearchIntegrityEventInsert,
  ResearchIntegrityEventRow,
} from "./types";

const LINKS = "research_claim_methodology_links";
const DECISIONS = "research_integrity_decisions";
const EVENTS = "research_integrity_events";

// ---------------------------------------------------------------------
// research_claim_methodology_links
// ---------------------------------------------------------------------

export async function linkClaimToMethodology(
  supabase: SupabaseClient,
  input: ResearchClaimMethodologyLinkInsert,
): Promise<ResearchClaimMethodologyLinkRow> {
  const { data, error } = await supabase.from(LINKS).insert(input).select("*").single();
  if (error) throw toDbError(error, "linkClaimToMethodology");
  return data as ResearchClaimMethodologyLinkRow;
}

export async function listClaimMethodologyLinks(
  supabase: SupabaseClient,
  projectId: string,
  claimId?: string,
): Promise<ResearchClaimMethodologyLinkRow[]> {
  let query = supabase.from(LINKS).select("*").eq("project_id", projectId);
  if (claimId) query = query.eq("claim_id", claimId);

  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw toDbError(error, "listClaimMethodologyLinks");
  return data as ResearchClaimMethodologyLinkRow[];
}

export async function unlinkClaimMethodology(
  supabase: SupabaseClient,
  projectId: string,
  linkId: string,
): Promise<void> {
  const { error } = await supabase.from(LINKS).delete().eq("id", linkId).eq("project_id", projectId);
  if (error) throw toDbError(error, "unlinkClaimMethodology");
}

// ---------------------------------------------------------------------
// research_integrity_decisions
//
// The one mutable piece of Phase 19: findings are recomputed on every
// review and have no row of their own, but a researcher's disposition of
// one ("I looked at this, it's fine") must survive the next recompute.
// Keyed on the finding's own stable id, not a foreign key, because the
// finding is never a row.
// ---------------------------------------------------------------------

export async function getIntegrityDecision(
  supabase: SupabaseClient,
  projectId: string,
  findingId: string,
): Promise<ResearchIntegrityDecisionRow | null> {
  const { data, error } = await supabase
    .from(DECISIONS)
    .select("*")
    .eq("project_id", projectId)
    .eq("finding_id", findingId)
    .maybeSingle();

  if (error) throw toDbError(error, "getIntegrityDecision");
  return (data as ResearchIntegrityDecisionRow | null) ?? null;
}

export async function listIntegrityDecisions(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchIntegrityDecisionRow[]> {
  const { data, error } = await supabase.from(DECISIONS).select("*").eq("project_id", projectId);
  if (error) throw toDbError(error, "listIntegrityDecisions");
  return data as ResearchIntegrityDecisionRow[];
}

/**
 * The only write path for a decision. Always upserts on (project_id,
 * finding_id) rather than requiring the caller to know whether a decision
 * already exists — a researcher revisiting a finding is updating their
 * decision, not creating a second one.
 */
export async function upsertIntegrityDecision(
  supabase: SupabaseClient,
  projectId: string,
  findingId: string,
  patch: ResearchIntegrityDecisionUpdate & { actor_id?: string | null },
): Promise<ResearchIntegrityDecisionRow> {
  const input: ResearchIntegrityDecisionInsert = {
    project_id: projectId,
    finding_id: findingId,
    ...patch,
  };
  const { data, error } = await supabase
    .from(DECISIONS)
    .upsert(input, { onConflict: "project_id,finding_id" })
    .select("*")
    .single();

  if (error) throw toDbError(error, "upsertIntegrityDecision");
  return data as ResearchIntegrityDecisionRow;
}

// ---------------------------------------------------------------------
// research_integrity_events — append and read only. Same discipline as
// methodology_events: no update, no delete, the grant in the migration
// does not include them either.
// ---------------------------------------------------------------------

export async function recordIntegrityEvent(
  supabase: SupabaseClient,
  input: ResearchIntegrityEventInsert,
): Promise<ResearchIntegrityEventRow> {
  const { data, error } = await supabase.from(EVENTS).insert(input).select("*").single();
  if (error) throw toDbError(error, "recordIntegrityEvent");
  return data as ResearchIntegrityEventRow;
}

export async function listIntegrityEvents(
  supabase: SupabaseClient,
  projectId: string,
  options: { limit?: number; before?: string; entityId?: string } = {},
): Promise<ResearchIntegrityEventRow[]> {
  let query = supabase
    .from(EVENTS)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(Math.min(options.limit ?? 50, 200));

  if (options.before) query = query.lt("created_at", options.before);
  if (options.entityId) query = query.eq("entity_id", options.entityId);

  const { data, error } = await query;
  if (error) throw toDbError(error, "listIntegrityEvents");
  return data as ResearchIntegrityEventRow[];
}
