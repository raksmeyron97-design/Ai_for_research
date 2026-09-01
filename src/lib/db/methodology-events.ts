import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError } from "./errors";
import type { MethodologyEventInsert, MethodologyEventRow } from "./types";

const EVENTS = "methodology_events";

/**
 * The methodology audit log (§23).
 *
 * Append and read. There is deliberately no update and no delete: the grant in
 * the migration does not include them either, because an audit log its own
 * owner can quietly rewrite is not an audit log. The one intended removal path
 * is project deletion, which cascades.
 */
export async function recordMethodologyEvent(
  supabase: SupabaseClient,
  input: MethodologyEventInsert,
): Promise<MethodologyEventRow> {
  const { data, error } = await supabase.from(EVENTS).insert(input).select("*").single();
  if (error) throw toDbError(error, "recordMethodologyEvent");
  return data as MethodologyEventRow;
}

/**
 * Newest first, capped. A methodology history is read as "what changed
 * recently", so the workspace pages it rather than loading every event a
 * long-running project has accumulated (§35).
 */
export async function listMethodologyEvents(
  supabase: SupabaseClient,
  projectId: string,
  options: { limit?: number; before?: string; entityId?: string } = {},
): Promise<MethodologyEventRow[]> {
  let query = supabase
    .from(EVENTS)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(Math.min(options.limit ?? 50, 200));

  if (options.before) query = query.lt("created_at", options.before);
  if (options.entityId) query = query.eq("entity_id", options.entityId);

  const { data, error } = await query;
  if (error) throw toDbError(error, "listMethodologyEvents");
  return data as MethodologyEventRow[];
}
