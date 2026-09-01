import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError } from "./errors";
import type { ResearchSourceProfileInsert, ResearchSourceProfileRow } from "./types";

const TABLE = "research_source_profiles";

/**
 * The comparable facts about a source (§20).
 *
 * A field left null is "not available in source", and that is a real answer —
 * so nothing here defaults a null to an empty string or a placeholder
 * sentence. The distinction survives into the comparison table, where an
 * absent cell reads "Not available in source" rather than looking like an
 * extracted fact.
 */
export async function listSourceProfiles(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchSourceProfileRow[]> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("project_id", projectId);
  if (error) throw toDbError(error, "listSourceProfiles");
  return data as ResearchSourceProfileRow[];
}

export async function getSourceProfiles(
  supabase: SupabaseClient,
  projectId: string,
  citationIds: string[],
): Promise<ResearchSourceProfileRow[]> {
  if (citationIds.length === 0) return [];
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("project_id", projectId)
    .in("citation_id", citationIds);

  if (error) throw toDbError(error, "getSourceProfiles");
  return data as ResearchSourceProfileRow[];
}

/**
 * Upsert on (project_id, citation_id): re-running extraction for a source
 * should refresh its profile, not accumulate a second one.
 */
export async function upsertSourceProfile(
  supabase: SupabaseClient,
  input: ResearchSourceProfileInsert,
): Promise<ResearchSourceProfileRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(input, { onConflict: "project_id,citation_id" })
    .select("*")
    .single();

  if (error) throw toDbError(error, "upsertSourceProfile");
  return data as ResearchSourceProfileRow;
}
