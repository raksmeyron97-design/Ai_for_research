import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError } from "./errors";
import type { ResearchInstrumentInsert, ResearchInstrumentRow } from "./types";

const TABLE = "research_instruments";

export async function listInstruments(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchInstrumentRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw toDbError(error, "listInstruments");
  return data as ResearchInstrumentRow[];
}

export async function getInstrument(
  supabase: SupabaseClient,
  instrumentId: string,
): Promise<ResearchInstrumentRow | null> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", instrumentId).maybeSingle();
  if (error) throw toDbError(error, "getInstrument");
  return data as ResearchInstrumentRow | null;
}

export async function createInstrument(
  supabase: SupabaseClient,
  input: ResearchInstrumentInsert,
): Promise<ResearchInstrumentRow> {
  const { data, error } = await supabase.from(TABLE).insert(input).select("*").single();
  if (error) throw toDbError(error, "createInstrument");
  return data as ResearchInstrumentRow;
}

export async function deleteInstrument(supabase: SupabaseClient, instrumentId: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", instrumentId);
  if (error) throw toDbError(error, "deleteInstrument");
}
