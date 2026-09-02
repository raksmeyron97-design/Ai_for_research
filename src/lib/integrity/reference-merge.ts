import type { SupabaseClient } from "@supabase/supabase-js";
import { getCitationsByIds } from "../db/citations";
import { toDbError } from "../db/errors";
import { recordIntegrityEvent } from "../db/integrity";
import type { ResearchCitationRow } from "../db/types";

export class ReferenceMergeError extends Error {}

/**
 * §21/§31: a duplicate is never merged automatically. This is the one action
 * a researcher explicitly triggers, and even then it repoints references
 * rather than deleting anything by inference. It only touches the chains
 * Phase 19 itself owns — `research_evidence.citation_id`,
 * `questionnaire_questions.source_citation_id`, `research_gaps.citation_id`.
 *
 * It deliberately refuses (rather than silently drops) a duplicate that has
 * Phase 17B literature-workspace links (`research_theme_sources`,
 * `research_source_profiles`) — those are theming/profiling judgements this
 * phase does not own, and repointing or discarding them here would be a
 * decision this merge action was never asked to make.
 */
export async function mergeCitations(
  supabase: SupabaseClient,
  projectId: string,
  primaryId: string,
  duplicateId: string,
): Promise<ResearchCitationRow> {
  if (primaryId === duplicateId) {
    throw new ReferenceMergeError("A reference cannot be merged into itself.");
  }

  const citations = await getCitationsByIds(supabase, [primaryId, duplicateId]);
  const primary = citations.find((c) => c.id === primaryId && c.project_id === projectId);
  const duplicate = citations.find((c) => c.id === duplicateId && c.project_id === projectId);
  if (!primary || !duplicate) {
    throw new ReferenceMergeError("Both references must belong to this project.");
  }

  const [themeLinks, profileLinks] = await Promise.all([
    supabase.from("research_theme_sources").select("id").eq("citation_id", duplicateId),
    supabase.from("research_source_profiles").select("id").eq("citation_id", duplicateId),
  ]);
  if ((themeLinks.data?.length ?? 0) > 0 || (profileLinks.data?.length ?? 0) > 0) {
    throw new ReferenceMergeError(
      "This reference has theme or source-profile links from the Literature workspace. Remove those first, or merge from there instead.",
    );
  }

  const repoint = async (table: string, column: string) => {
    const { error } = await supabase.from(table).update({ [column]: primaryId }).eq(column, duplicateId).eq("project_id", projectId);
    if (error) throw toDbError(error, `mergeCitations: repointing ${table}`);
  };

  await repoint("research_evidence", "citation_id");
  await repoint("questionnaire_questions", "source_citation_id");
  await repoint("research_gaps", "citation_id");

  const { error: deleteError } = await supabase.from("research_citations").delete().eq("id", duplicateId).eq("project_id", projectId);
  if (deleteError) throw toDbError(deleteError, "mergeCitations: removing the duplicate");

  await recordIntegrityEvent(supabase, {
    project_id: projectId,
    entity_type: "reference",
    entity_id: primaryId,
    action: "reference_merged",
    summary: `Merged "${duplicate.citation_key}" into "${primary.citation_key}"`,
    previous_value: { primary, duplicate } as unknown as Record<string, unknown>,
    new_value: { primaryId, mergedCitationKey: duplicate.citation_key } as unknown as Record<string, unknown>,
  }).catch(() => undefined);

  return primary;
}
