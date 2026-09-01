import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError } from "./errors";
import type { SectionType } from "./types";

const TABLE = "research_section_versions";

export type SectionChangeAction = "manual" | "insert" | "replace" | "append" | "ai_generate";

export interface SectionVersionRow {
  id: string;
  project_id: string;
  section_id: string;
  section_type: SectionType;
  previous_content: string;
  new_content: string;
  action: SectionChangeAction;
  provider: string | null;
  model: string | null;
  section_action: string | null;
  created_by: string | null;
  created_at: string;
}

export interface SectionVersionInsert {
  project_id: string;
  section_id: string;
  section_type: SectionType;
  previous_content: string;
  new_content: string;
  action: SectionChangeAction;
  provider?: string | null;
  model?: string | null;
  section_action?: string | null;
  created_by?: string | null;
}

/**
 * Records one accepted change. Called after the section itself is saved, so a
 * failed save never leaves a version claiming a change that did not happen.
 */
export async function recordSectionVersion(
  supabase: SupabaseClient,
  input: SectionVersionInsert,
): Promise<SectionVersionRow> {
  const { data, error } = await supabase.from(TABLE).insert(input).select("*").single();
  if (error) throw toDbError(error, "recordSectionVersion");
  return data as SectionVersionRow;
}

/** Newest first. `limit` keeps a long-lived section's history from becoming an unbounded response. */
export async function listSectionVersions(
  supabase: SupabaseClient,
  sectionId: string,
  limit = 25,
): Promise<SectionVersionRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("section_id", sectionId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw toDbError(error, "listSectionVersions");
  return data as SectionVersionRow[];
}
