import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError } from "./errors";
import type {
  ResearchCitationInsert,
  ResearchCitationRow,
  ResearchCitationUpdate,
} from "./types";

const TABLE = "research_citations";

export async function listCitations(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchCitationRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw toDbError(error, "listCitations");
  return data as ResearchCitationRow[];
}

export async function getCitation(
  supabase: SupabaseClient,
  citationId: string,
): Promise<ResearchCitationRow | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", citationId)
    .maybeSingle();

  if (error) throw toDbError(error, "getCitation");
  return data as ResearchCitationRow | null;
}

export async function getCitationsByIds(
  supabase: SupabaseClient,
  citationIds: string[],
): Promise<ResearchCitationRow[]> {
  if (citationIds.length === 0) return [];
  const { data, error } = await supabase.from(TABLE).select("*").in("id", citationIds);
  if (error) throw toDbError(error, "getCitationsByIds");
  return data as ResearchCitationRow[];
}

/**
 * Upsert on (project_id, citation_key) rather than plain insert: the same
 * source can legitimately come up again from a later AI response or a
 * fresh literature search within the same project, and the unique
 * constraint would otherwise turn a routine re-citation into an error the
 * caller has to handle specially.
 */
export async function upsertCitation(
  supabase: SupabaseClient,
  input: ResearchCitationInsert,
): Promise<ResearchCitationRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(input, { onConflict: "project_id,citation_key" })
    .select("*")
    .single();

  if (error) throw toDbError(error, "upsertCitation");
  return data as ResearchCitationRow;
}

export async function updateCitation(
  supabase: SupabaseClient,
  citationId: string,
  patch: ResearchCitationUpdate,
): Promise<ResearchCitationRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", citationId)
    .select("*")
    .single();

  if (error) throw toDbError(error, "updateCitation");
  return data as ResearchCitationRow;
}

export async function deleteCitation(supabase: SupabaseClient, citationId: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", citationId);
  if (error) throw toDbError(error, "deleteCitation");
}
