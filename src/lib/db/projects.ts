import type { SupabaseClient } from "@supabase/supabase-js";
import { removeAllDocumentStorage } from "./documents";
import { toDbError } from "./errors";
import { SECTION_CHAIN } from "./types";
import type {
  ResearchProjectInsert,
  ResearchProjectRow,
  ResearchProjectUpdate,
  SectionType,
} from "./types";

export { SECTION_CHAIN };

const TABLE = "research_projects";

/**
 * All functions here take the caller's request-scoped Supabase client
 * (src/lib/supabase/server.ts's createClient(), built from the caller's
 * session cookies) — RLS does the actual "only your own projects"
 * enforcement (supabase/migrations/*_phase2_rls_policies.sql). These
 * functions do not add a redundant .eq('user_id', ...) filter for reads;
 * RLS is the authoritative boundary, not a second copy of it here.
 */

export async function listProjects(supabase: SupabaseClient): Promise<ResearchProjectRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) throw toDbError(error, "listProjects");
  return data as ResearchProjectRow[];
}

export async function getProject(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchProjectRow | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("id", projectId)
    .maybeSingle();

  if (error) throw toDbError(error, "getProject");
  return data as ResearchProjectRow | null;
}

export async function createProject(
  supabase: SupabaseClient,
  userId: string,
  input: Omit<ResearchProjectInsert, "user_id">,
): Promise<ResearchProjectRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .insert({ ...input, user_id: userId })
    .select("*")
    .single();

  if (error) throw toDbError(error, "createProject");
  return data as ResearchProjectRow;
}

export async function updateProject(
  supabase: SupabaseClient,
  projectId: string,
  patch: ResearchProjectUpdate,
): Promise<ResearchProjectRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .update(patch)
    .eq("id", projectId)
    .select("*")
    .single();

  if (error) throw toDbError(error, "updateProject");
  return data as ResearchProjectRow;
}

/**
 * Storage files are removed before the row that cascade-deletes their DB
 * records (see removeAllDocumentStorage) — the same "storage before row"
 * ordering deleteDocument() uses, so a storage failure leaves the project
 * (and its documents' rows) intact rather than deleting the DB records
 * while orphaning the files.
 */
export async function deleteProject(supabase: SupabaseClient, projectId: string): Promise<void> {
  await removeAllDocumentStorage(supabase, projectId);

  const { error } = await supabase.from(TABLE).delete().eq("id", projectId);
  if (error) throw toDbError(error, "deleteProject");
}

export interface ProjectProgress {
  totalSections: number;
  completedSections: number;
  inProgressSections: number;
  percent: number;
}

/**
 * Progress is computed on read, not stored — a section with no row yet is
 * "not_started" implicitly, so there's nothing to keep in sync. This
 * backs the progress indicator described in the workspace UI (spec §3).
 */
export async function getProjectProgress(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ProjectProgress> {
  const { data, error } = await supabase
    .from("research_sections")
    .select("section_type, status")
    .eq("project_id", projectId);

  if (error) throw toDbError(error, "getProjectProgress");

  const statusByType = new Map((data as { section_type: SectionType; status: string }[]).map(
    (row) => [row.section_type, row.status],
  ));

  let completedSections = 0;
  let inProgressSections = 0;
  for (const sectionType of SECTION_CHAIN) {
    const status = statusByType.get(sectionType);
    if (status === "completed") completedSections++;
    else if (status === "in_progress") inProgressSections++;
  }

  const totalSections = SECTION_CHAIN.length;
  return {
    totalSections,
    completedSections,
    inProgressSections,
    percent: Math.round((completedSections / totalSections) * 100),
  };
}
