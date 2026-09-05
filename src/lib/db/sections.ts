import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError } from "./errors";
import type { ResearchSectionInsert, ResearchSectionRow, SectionType } from "./types";

const TABLE = "research_sections";

export async function listSections(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchSectionRow[]> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("project_id", projectId);
  if (error) throw toDbError(error, "listSections");
  return data as ResearchSectionRow[];
}

export async function getSection(
  supabase: SupabaseClient,
  projectId: string,
  sectionType: SectionType,
): Promise<ResearchSectionRow | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("project_id", projectId)
    .eq("section_type", sectionType)
    .maybeSingle();

  if (error) throw toDbError(error, "getSection");
  return data as ResearchSectionRow | null;
}

/** One row per (project_id, section_type) — upsert so "save my edits" never has to branch on whether the row already exists. */
export async function upsertSection(
  supabase: SupabaseClient,
  input: ResearchSectionInsert,
): Promise<ResearchSectionRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .upsert(input, { onConflict: "project_id,section_type" })
    .select("*")
    .single();

  if (error) throw toDbError(error, "upsertSection");
  return data as ResearchSectionRow;
}

/**
 * Only the named sections, and only the two columns a caller needs to tell
 * whether they have been written.
 *
 * The section-review service needs "do the sections this one follows from
 * have content?" — asking `listSections` would pull every section's full text
 * to answer it, which is the whole-project fetch §5 rules out.
 */
export async function getSectionsByTypes(
  supabase: SupabaseClient,
  projectId: string,
  sectionTypes: SectionType[],
): Promise<Pick<ResearchSectionRow, "section_type" | "content">[]> {
  if (sectionTypes.length === 0) return [];

  const { data, error } = await supabase
    .from(TABLE)
    .select("section_type, content")
    .eq("project_id", projectId)
    .in("section_type", sectionTypes);

  if (error) throw toDbError(error, "getSectionsByTypes");
  return data as Pick<ResearchSectionRow, "section_type" | "content">[];
}
