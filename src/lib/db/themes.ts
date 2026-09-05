import type { SupabaseClient } from "@supabase/supabase-js";
import { DbError, toDbError } from "./errors";
import type { ResearchThemeInsert, ResearchThemeRow, ResearchThemeSourceRow } from "./types";

const THEMES = "research_themes";
const THEME_SOURCES = "research_theme_sources";

/**
 * Literature themes (§22).
 *
 * Every function takes `projectId` and filters on it, even where an id alone
 * would be unique. RLS already scopes reads, but §34's rule is that an object
 * id is never sufficient authorisation on its own — a delete that matched on
 * `id` alone would depend entirely on a policy being right, and the composite
 * foreign keys in the migration exist for the same reason.
 */
export async function listThemes(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchThemeRow[]> {
  const { data, error } = await supabase
    .from(THEMES)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) throw toDbError(error, "listThemes");
  return data as ResearchThemeRow[];
}

export async function createTheme(
  supabase: SupabaseClient,
  input: ResearchThemeInsert,
): Promise<ResearchThemeRow> {
  const { data, error } = await supabase.from(THEMES).insert(input).select("*").single();
  if (error) throw toDbError(error, "createTheme");
  return data as ResearchThemeRow;
}

export async function renameTheme(
  supabase: SupabaseClient,
  projectId: string,
  themeId: string,
  patch: { name?: string; description?: string | null; confirmed?: boolean },
): Promise<ResearchThemeRow> {
  const { data, error } = await supabase
    .from(THEMES)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", themeId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) throw toDbError(error, "renameTheme");
  if (!data) throw new DbError("renameTheme: theme not found", true);
  return data as ResearchThemeRow;
}

export async function deleteTheme(
  supabase: SupabaseClient,
  projectId: string,
  themeId: string,
): Promise<void> {
  // Assignments cascade from the composite key; the sources themselves are
  // untouched. Deleting a theme is a filing decision, not a decision about the
  // literature.
  const { error } = await supabase
    .from(THEMES)
    .delete()
    .eq("id", themeId)
    .eq("project_id", projectId);

  if (error) throw toDbError(error, "deleteTheme");
}

export async function listThemeSources(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchThemeSourceRow[]> {
  const { data, error } = await supabase
    .from(THEME_SOURCES)
    .select("*")
    .eq("project_id", projectId);

  if (error) throw toDbError(error, "listThemeSources");
  return data as ResearchThemeSourceRow[];
}

export async function assignSourceToTheme(
  supabase: SupabaseClient,
  input: { project_id: string; theme_id: string; citation_id: string; ai_suggested?: boolean },
): Promise<ResearchThemeSourceRow> {
  const { data, error } = await supabase.from(THEME_SOURCES).insert(input).select("*").single();
  if (error) throw toDbError(error, "assignSourceToTheme");
  return data as ResearchThemeSourceRow;
}

export async function removeSourceFromTheme(
  supabase: SupabaseClient,
  projectId: string,
  themeId: string,
  citationId: string,
): Promise<void> {
  const { error } = await supabase
    .from(THEME_SOURCES)
    .delete()
    .eq("project_id", projectId)
    .eq("theme_id", themeId)
    .eq("citation_id", citationId);

  if (error) throw toDbError(error, "removeSourceFromTheme");
}
