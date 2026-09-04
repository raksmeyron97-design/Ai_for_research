import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError } from "./errors";
import type {
  ResearchFrameworkNodeInsert,
  ResearchFrameworkNodeRow,
  ResearchFrameworkNodeUpdate,
  ResearchFrameworkRelationshipInsert,
  ResearchFrameworkRelationshipRow,
  ResearchFrameworkRelationshipUpdate,
} from "./types";

/**
 * The conceptual framework's data access (Phase 20).
 *
 * Same rule as every module since Phase 17: every function takes `projectId`
 * and filters on it, even where the row id alone would be unique. An object
 * id is never sufficient authorisation on its own — a query matching on `id`
 * alone would depend entirely on a policy being right, and Phase 17 found
 * that assumption wrong once already.
 *
 * Writes filter on `project_id` too, which is what makes a cross-project
 * update a zero-row result rather than a successful edit of someone else's
 * diagram.
 */
const NODES = "research_framework_nodes";
const RELATIONSHIPS = "research_framework_relationships";

function stamped<T extends object>(patch: T): T & { updated_at: string } {
  return { ...patch, updated_at: new Date().toISOString() };
}

// ---------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------
/**
 * Ordered by the researcher's layout, then by creation (Phase 21 §13).
 *
 * Phase 20 ordered by `created_at` alone, which made the stored coordinates
 * unreachable: a node could be moved and the list would not move with it. The
 * order is now position first, so a reorder is visible, with `created_at` and
 * then `id` behind it — `id` last for the same reason the source search
 * carries it, that a list ordered only by columns which can tie is a list
 * whose rows swap places between two reads of the same data.
 *
 * §15: this reads coordinates to *display* nodes in an order. Nothing that
 * decides anything about the research reads them.
 */
export async function listFrameworkNodes(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchFrameworkNodeRow[]> {
  const { data, error } = await supabase
    .from(NODES)
    .select("*")
    .eq("project_id", projectId)
    .order("position_y", { ascending: true })
    .order("position_x", { ascending: true })
    .order("created_at", { ascending: true })
    .order("id", { ascending: true });

  if (error) throw toDbError(error, "listFrameworkNodes");
  return data as ResearchFrameworkNodeRow[];
}

/**
 * Applies a complete node order in one statement (Phase 21 §13, §36, §50).
 *
 * Delegates to the `reorder_framework_nodes` function rather than issuing one
 * PATCH per node, so the whole order lands or none of it does. The function
 * runs SECURITY INVOKER, so a caller naming another project's node updates
 * nothing and gets an error rather than a partial reorder.
 */
export async function reorderFrameworkNodes(
  supabase: SupabaseClient,
  projectId: string,
  orderedNodeIds: string[],
): Promise<ResearchFrameworkNodeRow[]> {
  const { data, error } = await supabase.rpc("reorder_framework_nodes", {
    p_project_id: projectId,
    p_node_ids: orderedNodeIds,
  });

  if (error) throw toDbError(error, "reorderFrameworkNodes");
  return (data ?? []) as ResearchFrameworkNodeRow[];
}

export async function getFrameworkNode(
  supabase: SupabaseClient,
  projectId: string,
  nodeId: string,
): Promise<ResearchFrameworkNodeRow | null> {
  const { data, error } = await supabase
    .from(NODES)
    .select("*")
    .eq("project_id", projectId)
    .eq("id", nodeId)
    .maybeSingle();

  if (error) throw toDbError(error, "getFrameworkNode");
  return data as ResearchFrameworkNodeRow | null;
}

export async function createFrameworkNode(
  supabase: SupabaseClient,
  input: ResearchFrameworkNodeInsert,
): Promise<ResearchFrameworkNodeRow> {
  const { data, error } = await supabase.from(NODES).insert(input).select("*").single();
  if (error) throw toDbError(error, "createFrameworkNode");
  return data as ResearchFrameworkNodeRow;
}

/**
 * Returns null rather than throwing when nothing matched. A patch scoped to
 * the caller's project that updates no rows means the node is not theirs (or
 * is gone), and the route turns that into the same 404 an unknown id gets —
 * so a probe cannot tell the two apart.
 */
export async function updateFrameworkNode(
  supabase: SupabaseClient,
  projectId: string,
  nodeId: string,
  patch: ResearchFrameworkNodeUpdate,
): Promise<ResearchFrameworkNodeRow | null> {
  const { data, error } = await supabase
    .from(NODES)
    .update(stamped(patch))
    .eq("project_id", projectId)
    .eq("id", nodeId)
    .select("*")
    .maybeSingle();

  if (error) throw toDbError(error, "updateFrameworkNode");
  return data as ResearchFrameworkNodeRow | null;
}

export async function deleteFrameworkNode(
  supabase: SupabaseClient,
  projectId: string,
  nodeId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from(NODES)
    .delete()
    .eq("project_id", projectId)
    .eq("id", nodeId)
    .select("id");

  if (error) throw toDbError(error, "deleteFrameworkNode");
  return (data ?? []).length > 0;
}

// ---------------------------------------------------------------------
// Relationships
// ---------------------------------------------------------------------
export async function listFrameworkRelationships(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchFrameworkRelationshipRow[]> {
  const { data, error } = await supabase
    .from(RELATIONSHIPS)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) throw toDbError(error, "listFrameworkRelationships");
  return data as ResearchFrameworkRelationshipRow[];
}

export async function createFrameworkRelationship(
  supabase: SupabaseClient,
  input: ResearchFrameworkRelationshipInsert,
): Promise<ResearchFrameworkRelationshipRow> {
  const { data, error } = await supabase.from(RELATIONSHIPS).insert(input).select("*").single();
  if (error) throw toDbError(error, "createFrameworkRelationship");
  return data as ResearchFrameworkRelationshipRow;
}

export async function updateFrameworkRelationship(
  supabase: SupabaseClient,
  projectId: string,
  relationshipId: string,
  patch: ResearchFrameworkRelationshipUpdate,
): Promise<ResearchFrameworkRelationshipRow | null> {
  const { data, error } = await supabase
    .from(RELATIONSHIPS)
    .update(stamped(patch))
    .eq("project_id", projectId)
    .eq("id", relationshipId)
    .select("*")
    .maybeSingle();

  if (error) throw toDbError(error, "updateFrameworkRelationship");
  return data as ResearchFrameworkRelationshipRow | null;
}

export async function deleteFrameworkRelationship(
  supabase: SupabaseClient,
  projectId: string,
  relationshipId: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from(RELATIONSHIPS)
    .delete()
    .eq("project_id", projectId)
    .eq("id", relationshipId)
    .select("id");

  if (error) throw toDbError(error, "deleteFrameworkRelationship");
  return (data ?? []).length > 0;
}
