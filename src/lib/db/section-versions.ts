import type { SupabaseClient } from "@supabase/supabase-js";
import { DbError, toDbError } from "./errors";
import type { SectionType } from "./types";

const TABLE = "research_section_versions";

export type SectionChangeAction =
  | "manual"
  | "insert"
  | "replace"
  | "append"
  | "ai_generate"
  | "restore";

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
  restored_from_version_id: string | null;
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
  restored_from_version_id?: string | null;
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

/**
 * Restores a section to an earlier version by writing a NEW version whose
 * content came from the old one (§22).
 *
 * The obvious implementation — overwrite the section and delete everything
 * after the restore point — is exactly what this must not do. A researcher
 * who restores an earlier draft and then changes their mind would have no way
 * back, and the history would silently lose the versions in between. So the
 * intermediate versions stay, and the restore itself becomes another entry
 * pointing at what it came from.
 */
export async function restoreSectionVersion(
  supabase: SupabaseClient,
  params: {
    projectId: string;
    sectionId: string;
    sectionType: SectionType;
    versionId: string;
    currentContent: string;
    userId?: string;
  },
): Promise<SectionVersionRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", params.versionId)
    .eq("project_id", params.projectId)
    .maybeSingle();

  if (error) throw toDbError(error, "restoreSectionVersion");
  // Scoped by project as well as id: a version from another project is
  // invisible under RLS and must read as "not found", not as an error that
  // hints it exists.
  if (!data) throw new DbError("restoreSectionVersion: version not found", true);

  const target = data as SectionVersionRow;
  if (target.section_id !== params.sectionId) {
    throw new DbError("restoreSectionVersion: version belongs to a different section", true);
  }

  return recordSectionVersion(supabase, {
    project_id: params.projectId,
    section_id: params.sectionId,
    section_type: params.sectionType,
    previous_content: params.currentContent,
    new_content: target.new_content,
    action: "restore",
    restored_from_version_id: target.id,
    created_by: params.userId ?? null,
  });
}
