import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError } from "./errors";
import type { ResearchDatasetInsert, ResearchDatasetRow } from "./types";

const TABLE = "research_datasets";

export async function listDatasets(
  supabase: SupabaseClient,
  projectId: string,
): Promise<Omit<ResearchDatasetRow, "data">[]> {
  // Excludes the (potentially large) `data` column — a list view never
  // needs the full row payload, just the metadata.
  const { data, error } = await supabase
    .from(TABLE)
    .select("id, project_id, uploaded_by, file_name, row_count, column_schema, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw toDbError(error, "listDatasets");
  return data as Omit<ResearchDatasetRow, "data">[];
}

export async function getDataset(
  supabase: SupabaseClient,
  datasetId: string,
): Promise<ResearchDatasetRow | null> {
  const { data, error } = await supabase.from(TABLE).select("*").eq("id", datasetId).maybeSingle();
  if (error) throw toDbError(error, "getDataset");
  return data as ResearchDatasetRow | null;
}

export async function createDataset(
  supabase: SupabaseClient,
  input: ResearchDatasetInsert,
): Promise<ResearchDatasetRow> {
  const { data, error } = await supabase.from(TABLE).insert(input).select("*").single();
  if (error) throw toDbError(error, "createDataset");
  return data as ResearchDatasetRow;
}

export async function deleteDataset(supabase: SupabaseClient, datasetId: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", datasetId);
  if (error) throw toDbError(error, "deleteDataset");
}
