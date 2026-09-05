import type { SupabaseClient } from "@supabase/supabase-js";
import { DbError, toDbError } from "./errors";
import type {
  ClaimType,
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

/** The links for one claim — the minimum needed to derive that claim's status. */
export async function listClaimEvidenceForClaim(
  supabase: SupabaseClient,
  projectId: string,
  claimId: string,
): Promise<ResearchClaimEvidenceRow[]> {
  const { data, error } = await supabase
    .from("research_claim_evidence")
    .select("*")
    .eq("project_id", projectId)
    .eq("claim_id", claimId);

  if (error) throw toDbError(error, "listClaimEvidenceForClaim");
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
  // Fetches this claim and this claim's links, not the project's. The first
  // version read every claim and every relation in the project to answer a
  // question about one of them, which is exactly the pattern §38 rules out —
  // and this runs on every evidence insertion.
  const [claim, links] = await Promise.all([
    getClaim(supabase, projectId, claimId),
    listClaimEvidenceForClaim(supabase, projectId, claimId),
  ]);

  // notFound=true so the API layer answers 404 rather than 500 — a claim that
  // belongs to another project is invisible under RLS and reaches here the
  // same way a deleted one does.
  if (!claim) throw new DbError(`refreshClaimStatus: claim ${claimId} not found`, true);

  const supports = links.map((l) => l.support as SupportLabel);
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

/**
 * One claim, scoped by project (§34). The project filter is not redundant
 * with RLS: it is what makes a claim id from another project read as "not
 * found" here rather than depending on a policy to hide it.
 */
export async function getClaim(
  supabase: SupabaseClient,
  projectId: string,
  claimId: string,
): Promise<ResearchClaimRow | null> {
  const { data, error } = await supabase
    .from("research_claims")
    .select("*")
    .eq("id", claimId)
    .eq("project_id", projectId)
    .maybeSingle();

  if (error) throw toDbError(error, "getClaim");
  return data as ResearchClaimRow | null;
}

/**
 * Edits a claim before evidence is searched for it (§11: claims are editable
 * before evidence search).
 *
 * `needs_evidence` and `evidence_status` are re-derived from the type rather
 * than accepted from the caller, for the same reason `createClaims` derives
 * them: they are a function of the type, and a caller able to set them
 * independently is how a claim ends up marked SUPPORTED before anything
 * supports it. Editing the type of a claim that already has links resets it to
 * the type's initial status; the next `refreshClaimStatus` re-derives from the
 * links.
 */
export async function updateClaim(
  supabase: SupabaseClient,
  projectId: string,
  claimId: string,
  patch: { claim_text?: string; claim_type?: ClaimType },
): Promise<ResearchClaimRow> {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.claim_text !== undefined) update.claim_text = patch.claim_text;
  if (patch.claim_type !== undefined) {
    update.claim_type = patch.claim_type;
    update.needs_evidence = claimNeedsEvidence(patch.claim_type);
    update.evidence_status = initialStatusFor(patch.claim_type);
  }

  const { data, error } = await supabase
    .from("research_claims")
    .update(update)
    .eq("id", claimId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) throw toDbError(error, "updateClaim");
  return data as ResearchClaimRow;
}

export async function deleteClaim(
  supabase: SupabaseClient,
  projectId: string,
  claimId: string,
): Promise<void> {
  const { error } = await supabase
    .from("research_claims")
    .delete()
    .eq("id", claimId)
    .eq("project_id", projectId);

  if (error) throw toDbError(error, "deleteClaim");
}

export async function getEvidenceByIds(
  supabase: SupabaseClient,
  projectId: string,
  evidenceIds: string[],
): Promise<ResearchEvidenceRow[]> {
  if (evidenceIds.length === 0) return [];
  const { data, error } = await supabase
    .from("research_evidence")
    .select("*")
    .eq("project_id", projectId)
    .in("id", evidenceIds);

  if (error) throw toDbError(error, "getEvidenceByIds");
  return data as ResearchEvidenceRow[];
}

/**
 * Records the support judgement a researcher made when previewing evidence
 * (§15), and — when the citation was actually written into the section —
 * where and when (§18).
 */
export async function updateClaimEvidence(
  supabase: SupabaseClient,
  projectId: string,
  relationId: string,
  patch: {
    support?: SupportLabel;
    note?: string | null;
    inserted_into_section?: SectionType | null;
    inserted_at?: string | null;
  },
): Promise<ResearchClaimEvidenceRow> {
  const { data, error } = await supabase
    .from("research_claim_evidence")
    .update(patch)
    .eq("id", relationId)
    .eq("project_id", projectId)
    .select("*")
    .single();

  if (error) throw toDbError(error, "updateClaimEvidence");
  return data as ResearchClaimEvidenceRow;
}
