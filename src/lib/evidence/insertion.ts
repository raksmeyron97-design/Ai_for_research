import type { SupabaseClient } from "@supabase/supabase-js";
import { getCitation } from "../db/citations";
import { DbError } from "../db/errors";
import {
  createEvidence,
  getClaim,
  linkClaimEvidence,
  listClaimEvidenceForClaim,
  refreshClaimStatus,
  updateClaimEvidence,
} from "../db/evidence";
import { getSection, upsertSection } from "../db/sections";
import { recordSectionVersion } from "../db/section-versions";
import type {
  ResearchClaimEvidenceRow,
  ResearchClaimRow,
  ResearchCitationRow,
  ResearchEvidenceRow,
  SectionType,
  SupportLabel,
} from "../db/types";
import { placeCitation, replaceClaimText, type PlacementOutcome } from "./citation-insertion";

/**
 * Evidence insertion (§16-§19).
 *
 * The chain the brief asks for — Claim → Evidence → Citation → Relation →
 * Section — is written here in that order, and the relation is the part that
 * matters. Appending `[key]` to the text and stopping there is what the app
 * did before: the bracket survives, the reason for it does not, and nothing
 * can later answer "why does this citation appear here?" (§18). So the
 * `research_claim_evidence` row is the primary write and the text edit is a
 * consequence of it, not the other way round.
 */
export type InsertionMode = "citation_only" | "evidence_citation" | "replace_claim";

export class EvidenceInsertionError extends Error {
  constructor(
    message: string,
    public readonly userMessage: string,
    public readonly status: number = 400,
  ) {
    super(message);
    this.name = "EvidenceInsertionError";
  }
}

export interface InsertEvidenceParams {
  projectId: string;
  section: SectionType;
  claimId: string;
  citationId: string;
  mode: InsertionMode;

  /** The excerpt to persist. Required unless the mode is citation-only and evidence already exists. */
  excerpt?: string;
  page?: number | null;
  sectionLabel?: string | null;
  chunkId?: string | null;
  documentId?: string | null;
  relevanceNote?: string | null;

  /** The researcher's judgement from the preview step (§15). Never defaulted to SUPPORTED. */
  support: SupportLabel;
  note?: string | null;

  /** Required for replace_claim, and only used there (§17). */
  replacementText?: string;

  /** Reuse an evidence row instead of creating one. */
  evidenceId?: string;

  userId?: string;
}

/** Deterministic post-insert checks (§19). Every one is a lookup, not a judgement. */
export interface InsertionValidation {
  sourceExists: boolean;
  evidenceExists: boolean;
  relationExists: boolean;
  projectMatches: boolean;
  citationExists: boolean;
  citationMetadataValid: boolean;
  /** Anything a researcher should know about the source record, in plain words. */
  notes: string[];
  ok: boolean;
}

export interface InsertEvidenceResult {
  claim: ResearchClaimRow;
  evidence: ResearchEvidenceRow;
  relation: ResearchClaimEvidenceRow;
  citation: ResearchCitationRow;
  /** Whether the citation token actually reached the section text, and why not. */
  placement: PlacementOutcome;
  sectionContent: string;
  /** The version row id, when the text changed. */
  versionId: string | null;
  validation: InsertionValidation;
}

/**
 * A source is usable as a citation when it has a key. Title, authors and year
 * are reported as missing rather than treated as invalid — a researcher who
 * has only a key and a URL has a real source, and refusing the insertion would
 * be the tool overruling them.
 */
function validateCitationMetadata(citation: ResearchCitationRow): { valid: boolean; notes: string[] } {
  const notes: string[] = [];
  if (!citation.citation_key) return { valid: false, notes: ["This source has no citation key."] };
  if (!citation.title) notes.push("This source has no title recorded.");
  if (citation.authors.length === 0) notes.push("This source has no authors recorded.");
  if (!citation.year) notes.push("This source has no year recorded.");
  return { valid: true, notes };
}

export async function insertEvidence(
  supabase: SupabaseClient,
  params: InsertEvidenceParams,
): Promise<InsertEvidenceResult> {
  // §34: every id in the request is re-resolved inside the project. An id on
  // its own is never authorisation, and both of these read as "not found"
  // rather than "forbidden" so a probe learns nothing.
  const [claim, citation] = await Promise.all([
    getClaim(supabase, params.projectId, params.claimId),
    getCitation(supabase, params.citationId),
  ]);

  if (!claim) throw new EvidenceInsertionError("claim not found", "That claim no longer exists.", 404);
  if (!citation || citation.project_id !== params.projectId) {
    throw new EvidenceInsertionError("citation not in project", "That source is not in this project.", 404);
  }
  if (claim.section_type !== params.section) {
    throw new EvidenceInsertionError(
      "claim belongs to a different section",
      "That claim belongs to a different section of your thesis.",
      400,
    );
  }
  if (params.mode === "replace_claim" && !params.replacementText?.trim()) {
    throw new EvidenceInsertionError(
      "replace_claim requires replacement text",
      "Replacing a claim needs the replacement wording. Nothing was changed.",
      400,
    );
  }

  // --- Evidence ---------------------------------------------------------
  let evidence: ResearchEvidenceRow;
  if (params.evidenceId) {
    const { data } = await supabase
      .from("research_evidence")
      .select("*")
      .eq("id", params.evidenceId)
      .eq("project_id", params.projectId)
      .maybeSingle();
    if (!data) throw new EvidenceInsertionError("evidence not found", "That evidence no longer exists.", 404);
    evidence = data as ResearchEvidenceRow;
  } else {
    if (!params.excerpt?.trim()) {
      throw new EvidenceInsertionError(
        "excerpt required",
        "An excerpt is required — evidence is a passage from a source, not a reference on its own.",
        400,
      );
    }
    // Persisted independently of the AI response that surfaced it (§10): the
    // excerpt is stored, so a later re-verification reads what the researcher
    // actually saw rather than re-running a search.
    evidence = await createEvidence(supabase, {
      project_id: params.projectId,
      citation_id: citation.id,
      document_id: params.documentId ?? null,
      chunk_id: params.chunkId ?? null,
      excerpt: params.excerpt.trim(),
      page: params.page ?? null,
      section_label: params.sectionLabel ?? null,
      relevance_note: params.relevanceNote ?? null,
    });
  }

  // --- Relation ---------------------------------------------------------
  // The support judgement comes from the researcher's preview choice and is
  // written on the relation, because the same excerpt can support one claim
  // and not another (§15).
  const insertedAt = new Date().toISOString();
  let relation: ResearchClaimEvidenceRow;
  const existingLinks = await listClaimEvidenceForClaim(supabase, params.projectId, claim.id);
  const already = existingLinks.find((l) => l.evidence_id === evidence.id);

  if (already) {
    relation = await updateClaimEvidence(supabase, params.projectId, already.id, {
      support: params.support,
      note: params.note ?? null,
      inserted_into_section: params.section,
      inserted_at: insertedAt,
    });
  } else {
    relation = await linkClaimEvidence(supabase, {
      project_id: params.projectId,
      claim_id: claim.id,
      evidence_id: evidence.id,
      support: params.support,
      note: params.note ?? null,
      inserted_into_section: params.section,
      inserted_at: insertedAt,
    });
  }

  // --- Section text -----------------------------------------------------
  const sectionRow = await getSection(supabase, params.projectId, params.section);
  const before = sectionRow?.content ?? "";
  const offsets = { start: claim.source_offset_start, end: claim.source_offset_end };

  const placement =
    params.mode === "replace_claim"
      ? replaceClaimText(before, claim.claim_text, params.replacementText as string, offsets)
      : placeCitation(before, claim.claim_text, citation.citation_key, offsets);

  // Replace mode places the citation into the replacement too, so a rewritten
  // sentence is not left uncited.
  const withCitation =
    params.mode === "replace_claim" && placement.outcome === "placed"
      ? placeCitation(
          placement.content,
          params.replacementText as string,
          citation.citation_key,
          undefined,
        )
      : placement;

  let versionId: string | null = null;
  let sectionContent = before;

  if (withCitation.content !== before) {
    const saved = await upsertSection(supabase, {
      project_id: params.projectId,
      section_type: params.section,
      content: withCitation.content,
      status: sectionRow?.status ?? "in_progress",
      metadata: sectionRow?.metadata ?? {},
    });
    sectionContent = saved.content;

    try {
      // §29: the action is what happened. This is not an AI rewrite — the
      // researcher chose a source and the app placed a bracket.
      const version = await recordSectionVersion(supabase, {
        project_id: params.projectId,
        section_id: saved.id,
        section_type: params.section,
        previous_content: before,
        new_content: saved.content,
        action: "evidence_insert",
        section_action: params.mode,
        created_by: params.userId ?? null,
      });
      versionId = version.id;
    } catch {
      // Losing a history entry must not fail an insertion the researcher is
      // waiting on; the content and the relation are already persisted.
    }
  }

  // --- Status, then validation -------------------------------------------
  // Derived from the relation's support judgement by `deriveClaimStatus` —
  // there is no path here that marks a claim SUPPORTED because a row exists.
  const updatedClaim = await refreshClaimStatus(supabase, params.projectId, claim.id);

  const metadata = validateCitationMetadata(citation);
  const notes = [...metadata.notes];
  if (withCitation.outcome === "claim_not_located") {
    notes.push(
      "The claim's wording has changed since it was extracted, so the citation was linked but not written into the text. Add it where you want it.",
    );
  }
  if (withCitation.outcome === "already_present") {
    notes.push("That citation was already in the sentence, so the text was left as it is.");
  }

  const validation: InsertionValidation = {
    sourceExists: true,
    evidenceExists: Boolean(evidence.id),
    relationExists: Boolean(relation.id),
    projectMatches:
      evidence.project_id === params.projectId &&
      relation.project_id === params.projectId &&
      citation.project_id === params.projectId,
    citationExists: true,
    citationMetadataValid: metadata.valid,
    notes,
    ok: false,
  };
  validation.ok =
    validation.evidenceExists &&
    validation.relationExists &&
    validation.projectMatches &&
    validation.citationMetadataValid;

  return {
    claim: updatedClaim,
    evidence,
    relation,
    citation,
    placement: withCitation.outcome,
    sectionContent,
    versionId,
    validation,
  };
}

/**
 * Resolves §18's question — "why does this citation appear here?" — for one
 * section, as Section → Claim → Evidence → Source → Citation.
 *
 * The Quality Checker will need exactly this, which is why it lives beside the
 * insertion that creates the rows rather than being rebuilt against them.
 */
export interface CitationProvenance {
  citationKey: string;
  citationId: string;
  claimId: string;
  claimText: string;
  evidenceId: string;
  excerpt: string;
  page: number | null;
  support: SupportLabel;
  insertedAt: string | null;
}

export async function explainSectionCitations(
  supabase: SupabaseClient,
  projectId: string,
  section: SectionType,
): Promise<CitationProvenance[]> {
  const { data: claims, error: claimsError } = await supabase
    .from("research_claims")
    .select("*")
    .eq("project_id", projectId)
    .eq("section_type", section);
  if (claimsError) throw new DbError(`explainSectionCitations: ${claimsError.message}`);

  const claimRows = (claims ?? []) as ResearchClaimRow[];
  if (claimRows.length === 0) return [];

  const { data: links } = await supabase
    .from("research_claim_evidence")
    .select("*")
    .eq("project_id", projectId)
    .in(
      "claim_id",
      claimRows.map((c) => c.id),
    );
  const linkRows = (links ?? []) as ResearchClaimEvidenceRow[];
  if (linkRows.length === 0) return [];

  const { data: evidence } = await supabase
    .from("research_evidence")
    .select("*")
    .eq("project_id", projectId)
    .in(
      "id",
      linkRows.map((l) => l.evidence_id),
    );
  const evidenceRows = (evidence ?? []) as ResearchEvidenceRow[];
  const evidenceById = new Map(evidenceRows.map((e) => [e.id, e]));

  const { data: citations } = await supabase
    .from("research_citations")
    .select("*")
    .eq("project_id", projectId)
    .in("id", [...new Set(evidenceRows.map((e) => e.citation_id))]);
  const citationById = new Map(((citations ?? []) as ResearchCitationRow[]).map((c) => [c.id, c]));

  const claimById = new Map(claimRows.map((c) => [c.id, c]));

  return linkRows.flatMap((link) => {
    const ev = evidenceById.get(link.evidence_id);
    const claim = claimById.get(link.claim_id);
    const citation = ev ? citationById.get(ev.citation_id) : undefined;
    if (!ev || !claim || !citation) return [];
    return [
      {
        citationKey: citation.citation_key,
        citationId: citation.id,
        claimId: claim.id,
        claimText: claim.claim_text,
        evidenceId: ev.id,
        excerpt: ev.excerpt,
        page: ev.page,
        support: link.support,
        insertedAt: link.inserted_at,
      },
    ];
  });
}
