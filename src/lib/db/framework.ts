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
export async function listFrameworkNodes(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchFrameworkNodeRow[]> {
  const { data, error } = await supabase
    .from(NODES)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) throw toDbError(error, "listFrameworkNodes");
  return data as ResearchFrameworkNodeRow[];
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
