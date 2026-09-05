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

/**
 * §17-§19's server-side source search.
 *
 * `listCitations` above still exists and is still right for the callers that
 * genuinely need every source — the exporter building a bibliography, the
 * integrity review auditing references. This is for the workspace, which
 * shows a page at a time and must not pull a 250-source library into the
 * browser to filter it there.
 *
 * The work happens in `search_project_sources` (see the Phase 20 migration).
 * It runs SECURITY INVOKER, so the caller's RLS is what decides visibility;
 * passing `projectId` is the query, not the authorisation.
 */
export interface SourceSearchParams {
  /** Free text over title, authors and journal, or a citation-key/DOI/PMID/ISBN prefix. */
  query?: string | null;
  yearFrom?: number | null;
  yearTo?: number | null;
  sourceTypes?: string[] | null;
  statuses?: string[] | null;
  /** `false` means "show the ones missing a DOI" — a real thing to look for
   *  when cleaning a bibliography, and different from "no opinion" (null). */
  hasDoi?: boolean | null;
  hasEvidence?: boolean | null;
  isCited?: boolean | null;
  themeId?: string | null;
  limit?: number;
  offset?: number;
}

/** A source row plus the two counts the workspace shows beside it, so the
 *  list does not need a second query per row to say "3 excerpts". */
export interface SourceSearchRow extends ResearchCitationRow {
  evidence_count: number;
  claim_count: number;
}

export interface SourceSearchResult {
  rows: SourceSearchRow[];
  /** Total matching the filters, not the page — what "Showing 25 of 248" needs. */
  total: number;
  limit: number;
  offset: number;
}

export async function searchCitations(
  supabase: SupabaseClient,
  projectId: string,
  params: SourceSearchParams = {},
): Promise<SourceSearchResult> {
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const offset = Math.max(params.offset ?? 0, 0);

  const { data, error } = await supabase.rpc("search_project_sources", {
    p_project_id: projectId,
    p_query: params.query ?? null,
    p_year_from: params.yearFrom ?? null,
    p_year_to: params.yearTo ?? null,
    p_source_types: params.sourceTypes ?? null,
    p_statuses: params.statuses ?? null,
    p_has_doi: params.hasDoi ?? null,
    p_has_evidence: params.hasEvidence ?? null,
    p_is_cited: params.isCited ?? null,
    p_theme_id: params.themeId ?? null,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) throw toDbError(error, "searchCitations");

  const raw = (data ?? []) as (SourceSearchRow & { total_count: number })[];
  return {
    // `total_count` rides on every row from a window function. Stripping it
    // here keeps it out of the API shape, where it would look like a property
    // of the source rather than of the result set.
    rows: raw.map(({ total_count: _total, ...row }) => row),
    // An empty page carries no row to read the count from, and zero is the
    // right answer then: no rows matched.
    total: raw[0]?.total_count ?? 0,
    limit,
    offset,
  };
}
