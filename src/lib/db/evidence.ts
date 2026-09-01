import type { SupabaseClient } from "@supabase/supabase-js";
import { DbError, toDbError } from "./errors";
import type {
  ResearchClaimEvidenceInsert,
  ResearchClaimEvidenceRow,
  ResearchClaimInsert,
  ResearchClaimRow,
  ResearchEvidenceInsert,
  ResearchEvidenceRow,
  SectionType,
  SupportLabel,
} from "./types";
import { claimNeedsEvidence, deriveClaimStatus, initialStatusFor } from "../evidence/status";

/**
 * Data access for the evidence model. Every function is project-scoped, and
 * cross-project references are additionally impossible at the schema level:
 * `research_evidence` and `research_claim_evidence` carry composite foreign
 * keys that include `project_id`, so a relation cannot point at another
 * project's claim even if a policy were written wrongly.
 */

export async function createClaims(
  supabase: SupabaseClient,
  claims: ResearchClaimInsert[],
): Promise<ResearchClaimRow[]> {
  if (claims.length === 0) return [];

  // needs_evidence and the initial status are derived here rather than taken
  // from the caller: they are a function of claim_type, and letting a caller
  // (or a model) set them independently is how a claim ends up marked
  // SUPPORTED before anything supports it.
  const rows = claims.map((c) => ({
    ...c,
    needs_evidence: claimNeedsEvidence(c.claim_type ?? "factual"),
    evidence_status: initialStatusFor(c.claim_type ?? "factual"),
  }));

  const { data, error } = await supabase.from("research_claims").insert(rows).select("*");
  if (error) throw toDbError(error, "createClaims");
  return data as ResearchClaimRow[];
}

export async function listClaims(
  supabase: SupabaseClient,
  projectId: string,
  sectionType?: SectionType,
): Promise<ResearchClaimRow[]> {
  let query = supabase.from("research_claims").select("*").eq("project_id", projectId);
  if (sectionType) query = query.eq("section_type", sectionType);

  const { data, error } = await query;
  if (error) throw toDbError(error, "listClaims");
  return data as ResearchClaimRow[];
}

export async function createEvidence(
  supabase: SupabaseClient,
  input: ResearchEvidenceInsert,
): Promise<ResearchEvidenceRow> {
  const { data, error } = await supabase.from("research_evidence").insert(input).select("*").single();
  if (error) throw toDbError(error, "createEvidence");
  return data as ResearchEvidenceRow;
}

export async function listEvidence(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchEvidenceRow[]> {
  const { data, error } = await supabase
    .from("research_evidence")
    .select("*")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false });

  if (error) throw toDbError(error, "listEvidence");
  return data as ResearchEvidenceRow[];
}

export async function linkClaimEvidence(
  supabase: SupabaseClient,
  input: ResearchClaimEvidenceInsert,
): Promise<ResearchClaimEvidenceRow> {
  const { data, error } = await supabase
    .from("research_claim_evidence")
    .insert(input)
    .select("*")
    .single();

  if (error) throw toDbError(error, "linkClaimEvidence");
  return data as ResearchClaimEvidenceRow;
}

export async function listClaimEvidence(
  supabase: SupabaseClient,
  projectId: string,
): Promise<ResearchClaimEvidenceRow[]> {
  const { data, error } = await supabase
    .from("research_claim_evidence")
    .select("*")
    .eq("project_id", projectId);

  if (error) throw toDbError(error, "listClaimEvidence");
  return data as ResearchClaimEvidenceRow[];
}

/**
 * Recomputes a claim's status from its links and persists it.
 *
 * The status is never written directly by a caller. It is always derived by
 * `deriveClaimStatus`, so the "NEEDS_VERIFICATION must not silently become
 * SUPPORTED" rule holds no matter which code path attached the evidence.
 */
export async function refreshClaimStatus(
  supabase: SupabaseClient,
  projectId: string,
  claimId: string,
): Promise<ResearchClaimRow> {
  const [claims, links] = await Promise.all([
    listClaims(supabase, projectId),
    listClaimEvidence(supabase, projectId),
  ]);

  const claim = claims.find((c) => c.id === claimId);
  // notFound=true so the API layer answers 404 rather than 500 — a claim that
  // belongs to another project is invisible under RLS and reaches here the
  // same way a deleted one does.
  if (!claim) throw new DbError(`refreshClaimStatus: claim ${claimId} not found`, true);

  const supports = links.filter((l) => l.claim_id === claimId).map((l) => l.support as SupportLabel);
  const status = deriveClaimStatus(claim.claim_type, supports);

  const { data, error } = await supabase
    .from("research_claims")
    .update({ evidence_status: status, updated_at: new Date().toISOString() })
    .eq("id", claimId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) throw toDbError(error, "refreshClaimStatus");
  return data as ResearchClaimRow;
}
