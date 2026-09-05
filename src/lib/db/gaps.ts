import type { SupabaseClient } from "@supabase/supabase-js";
import { toDbError } from "./errors";
import type { GapBasis, ResearchGapInsert, ResearchGapRow } from "./types";

const TABLE = "research_gaps";

/**
 * Research gaps (§23-§24).
 *
 * `basis` is stored, never inferred at read time, because the question a
 * reader asks of a gap matrix is "did the paper say this, or did something
 * work it out?" — and an answer reconstructed later would be a guess about a
 * guess.
 */
export async function listGaps(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchGapRow[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: true });

  if (error) throw toDbError(error, "listGaps");
  return data as ResearchGapRow[];
}

export async function createGaps(
  supabase: SupabaseClient,
  gaps: ResearchGapInsert[],
): Promise<ResearchGapRow[]> {
  if (gaps.length === 0) return [];
  const { data, error } = await supabase.from(TABLE).insert(gaps).select("*");
  if (error) throw toDbError(error, "createGaps");
  return data as ResearchGapRow[];
}

export async function updateGap(
  supabase: SupabaseClient,
  projectId: string,
  gapId: string,
  patch: { gap_text?: string; basis?: GapBasis; supporting_text?: string | null; verified?: boolean },
): Promise<ResearchGapRow> {
  const { data, error } = await supabase
    .from(TABLE)
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("id", gapId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) throw toDbError(error, "updateGap");
  return data as ResearchGapRow;
}

export async function deleteGap(
  supabase: SupabaseClient,
  projectId: string,
  gapId: string,
): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq("id", gapId).eq("project_id", projectId);
  if (error) throw toDbError(error, "deleteGap");
}
