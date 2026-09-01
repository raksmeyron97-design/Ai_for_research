"use client";

import { useCallback, useEffect, useState } from "react";
import EvidenceCard, { type EvidenceCardModel } from "@/components/EvidenceCard";
import EvidenceInsertPreview, { type InsertRequest } from "@/components/EvidenceInsertPreview";
import type { ClaimType, ResearchClaimRow, SectionType } from "@/lib/db/types";
import type { EvidenceCandidate } from "@/lib/evidence/evidence-search";
import type { ExtractedClaim } from "@/lib/evidence/claim-extraction";

/**
 * The researcher-facing evidence workflow (§11-§19).
 *
 * Select text → extract claims → edit them → find evidence → preview →
 * insert. Each step is a separate, reversible decision, which is the point:
 * the failure mode this replaces is a button that finds a source and writes a
 * citation in one motion, leaving the researcher unable to say afterwards
 * which claim the citation was for or whether anyone checked it.
 *
 * Nothing is computed here. Claims come from the extraction route, ranking and
 * relevance explanations from the search route, and coverage from the review
 * route — so what the researcher sees is what the tests assert on.
 */
const CLAIM_TYPES: { value: ClaimType; label: string }[] = [
  { value: "factual", label: "Factual" },
  { value: "statistical", label: "Statistical" },
  { value: "clinical", label: "Clinical" },
  { value: "comparative", label: "Comparative" },
  { value: "interpretive", label: "Interpretive" },
  { value: "user_provided", label: "My own data" },
  { value: "inference", label: "Inference" },
];

const STATUS_LABEL: Record<string, string> = {
  SUPPORTED: "Supported",
  PARTIALLY_SUPPORTED: "Partially supported",
  UNSUPPORTED: "Unsupported",
  USER_PROVIDED: "Your own data",
  INFERENCE: "Inference",
  NEEDS_VERIFICATION: "Needs evidence",
};

export interface EvidenceRequest {
  /** Passage the researcher selected in the editor, for extraction. */
  passage?: string;
  passageOffset?: number;
  /** An existing claim to search evidence for, e.g. from a review issue. */
  claimId?: string;
  /** Changes on every request so a repeat of the same passage still opens the panel. */
  nonce: number;
}

function toCardModel(candidate: EvidenceCandidate): EvidenceCardModel {
  return {
    id: candidate.chunk.id,
    sourceTitle: candidate.citation?.title ?? null,
    authors: candidate.citation?.authors ?? [],
    year: candidate.citation?.year ?? null,
    sourceType: candidate.citation?.source_type ?? null,
    tier: candidate.citation?.tier ?? null,
    citationKey: candidate.chunk.citation_key,
    sourceStatus: candidate.citation?.status ?? null,
    excerpt: candidate.chunk.content,
    page: candidate.chunk.page,
    sectionLabel: candidate.chunk.section,
    relevance: candidate.explanation,
    offTopic: candidate.belowRelevanceFloor,
    warning: candidate.injectionWarning,
    saved: candidate.alreadySaved,
  };
}

type Stage = "idle" | "extracting" | "searching" | "inserting";

export default function EvidencePanel({
  projectId,
  sectionType,
  request,
  onInserted,
  onOpenSource,
}: {
  projectId: string;
  sectionType: SectionType;
  request: EvidenceRequest | null;
  /** The section text after an insertion, so the editor can catch up (§27). */
  onInserted: (result: { content: string; claim: ResearchClaimRow }) => void;
  onOpenSource?: (citationId: string) => void;
}) {
  const [claims, setClaims] = useState<ResearchClaimRow[]>([]);
  const [drafts, setDrafts] = useState<ExtractedClaim[]>([]);
  const [activeClaim, setActiveClaim] = useState<ResearchClaimRow | null>(null);
  const [candidates, setCandidates] = useState<EvidenceCandidate[] | null>(null);
  const [selected, setSelected] = useState<EvidenceCandidate | null>(null);

  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [searchOutcome, setSearchOutcome] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<string | null>(null);
  const [passage, setPassage] = useState<{ text: string; offset: number } | null>(null);

  const loadClaims = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/research/projects/${projectId}/claims?sectionType=${sectionType}`,
      );
      if (!res.ok) return;
      const body = await res.json();
      setClaims(body.claims ?? []);
    } catch {
      // A failed claim list leaves the panel usable for extraction; it is not
      // worth an error banner over the whole workflow.
    }
  }, [projectId, sectionType]);

  useEffect(() => {
    void loadClaims();
  }, [loadClaims]);

  const searchEvidence = useCallback(
    async (claim: ResearchClaimRow) => {
      setActiveClaim(claim);
      setSelected(null);
      setCandidates(null);
      setSearchOutcome(null);
      setError(null);
      setStage("searching");
      try {
        const res = await fetch(
          `/api/research/projects/${projectId}/claims/${claim.id}/evidence-search`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // §36: a short window, not the section. The claim itself is read
            // server-side from the row, so nothing about it is sent again.
            body: JSON.stringify({}),
          },
        );
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setSearchOutcome(body.outcome ?? "retrieval_failed");
          setError(body.error ?? "The evidence search could not run.");
          return;
        }
        setSearchOutcome(body.outcome);
        setCandidates(body.candidates ?? []);
      } catch {
        setSearchOutcome("retrieval_failed");
        setError("The evidence search could not run. Nothing was changed — try again.");
      } finally {
        setStage("idle");
      }
    },
    [projectId],
  );

  // A request from the editor or the review panel drives the panel, rather
  // than the panel polling for one.
  useEffect(() => {
    if (!request) return;
    setConfirmation(null);
    if (request.passage) {
      setPassage({ text: request.passage, offset: request.passageOffset ?? 0 });
      setDrafts([]);
      setCandidates(null);
      setActiveClaim(null);
    }
    if (request.claimId) {
      void (async () => {
        const res = await fetch(`/api/research/projects/${projectId}/claims?sectionType=${sectionType}`);
        if (!res.ok) return;
        const body = await res.json();
        const found = (body.claims as ResearchClaimRow[]).find((c) => c.id === request.claimId);
        setClaims(body.claims ?? []);
        if (found) void searchEvidence(found);
      })();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.nonce]);

  async function extract() {
    if (!passage) return;
    setStage("extracting");
    setError(null);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/claims/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionType,
          passage: passage.text,
          passageOffset: passage.offset,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Claim extraction could not run.");
      setDrafts(body.claims ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStage("idle");
    }
  }

  async function saveDrafts() {
    if (drafts.length === 0) return;
    setError(null);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionType,
          claims: drafts.map((d) => ({
            text: d.text,
            type: d.type,
            offsetStart: d.offsetStart,
            offsetEnd: d.offsetEnd,
          })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Those claims could not be saved.");
      setDrafts([]);
      setClaims((prev) => [...prev, ...(body.claims ?? [])]);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function insert(req: InsertRequest) {
    if (!activeClaim || !selected) return;
    setStage("inserting");
    setError(null);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/evidence/insert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sectionType,
          claimId: activeClaim.id,
          citationId: selected.citation?.id,
          mode: req.mode,
          excerpt: selected.chunk.content,
          page: selected.chunk.page,
          sectionLabel: selected.chunk.section,
          chunkId: selected.chunk.id,
          documentId: selected.chunk.document_id,
          relevanceNote: selected.explanation,
          support: req.support,
          note: req.note,
          replacementText: req.replacementText,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The evidence could not be linked.");

      setClaims((prev) => prev.map((c) => (c.id === body.claim.id ? body.claim : c)));
      setActiveClaim(body.claim);
      setSelected(null);
      // Deterministic post-insert checks, reported as they came back (§19).
      setConfirmation(
        [
          body.validation?.ok ? "Evidence linked successfully." : "Evidence linked, with things to check.",
          ...(body.validation?.notes ?? []),
        ].join(" "),
      );
      onInserted({ content: body.sectionContent, claim: body.claim });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setStage("idle");
    }
  }

  return (
    <div className="flex h-full flex-col gap-3 overflow-y-auto p-3">
      <h3 className="text-sm font-medium">Evidence</h3>

      {confirmation && (
        <p role="status" className="rounded border border-green-300 bg-green-50 p-2 text-xs text-green-900">
          {confirmation}
        </p>
      )}
      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          {error}
        </p>
      )}

      {/* --- Step 1: extract from a selected passage ------------------- */}
      <section aria-labelledby="claims-heading" className="rounded border border-neutral-200 p-3">
        <h4 id="claims-heading" className="mb-2 text-xs font-medium text-neutral-700">
          Claims in this section
        </h4>

        {passage ? (
          <div className="mb-2">
            <p className="mb-1 rounded bg-neutral-50 p-2 text-[11px] leading-relaxed text-neutral-700">
              “{passage.text.slice(0, 220)}
              {passage.text.length > 220 ? "…" : ""}”
            </p>
            <button
              type="button"
              onClick={extract}
              disabled={stage === "extracting"}
              className="rounded bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
            >
              {stage === "extracting" ? "Extracting…" : "Extract claims"}
            </button>
          </div>
        ) : (
          <p className="mb-2 text-[11px] text-neutral-500">
            Select a paragraph in the editor and choose <strong>Find evidence</strong> to pull out its claims.
          </p>
        )}

        {drafts.length > 0 && (
          <div className="mb-3 space-y-2">
            <p className="text-[11px] text-neutral-500">
              Edit these before saving. The type is a suggestion — it decides whether a claim is expected to carry
              evidence, not whether it is true.
            </p>
            {drafts.map((draft, i) => (
              <div key={i} className="rounded border border-neutral-200 p-2">
                <label className="sr-only" htmlFor={`draft-${i}`}>
                  Claim {i + 1}
                </label>
                <textarea
                  id={`draft-${i}`}
                  value={draft.text}
                  rows={2}
                  onChange={(e) =>
                    setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, text: e.target.value } : d)))
                  }
                  className="w-full rounded border border-neutral-300 p-1.5 text-xs focus:border-neutral-500 focus:outline-none"
                />
                <div className="mt-1 flex items-center justify-between gap-2">
                  <select
                    aria-label={`Type for claim ${i + 1}`}
                    value={draft.type}
                    onChange={(e) =>
                      setDrafts((prev) =>
                        prev.map((d, j) => (j === i ? { ...d, type: e.target.value as ClaimType } : d)),
                      )
                    }
                    className="rounded border border-neutral-300 px-1.5 py-1 text-[11px]"
                  >
                    {CLAIM_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setDrafts((prev) => prev.filter((_, j) => j !== i))}
                    className="text-[11px] text-neutral-500 hover:text-neutral-900"
                  >
                    Discard
                  </button>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={saveDrafts}
              className="rounded bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
            >
              Save {drafts.length} claim{drafts.length === 1 ? "" : "s"}
            </button>
          </div>
        )}

        {claims.length === 0 ? (
          <p className="text-[11px] text-neutral-500">No claims recorded for this section yet.</p>
        ) : (
          <ul className="space-y-1">
            {claims.map((claim) => (
              <li
                key={claim.id}
                className={`rounded border p-2 ${
                  activeClaim?.id === claim.id ? "border-neutral-900" : "border-neutral-200"
                }`}
              >
                <p className="text-xs text-neutral-900">{claim.claim_text}</p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-[11px] text-neutral-500">
                    {claim.claim_type.replace(/_/g, " ")} · {STATUS_LABEL[claim.evidence_status]}
                  </span>
                  {claim.needs_evidence && (
                    <button
                      type="button"
                      onClick={() => searchEvidence(claim)}
                      disabled={stage === "searching"}
                      className="rounded border border-neutral-300 px-2 py-0.5 text-[11px] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
                    >
                      Find evidence
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* --- Step 2: evidence for the active claim --------------------- */}
      {activeClaim && (
        <section aria-labelledby="evidence-results-heading" className="rounded border border-neutral-200 p-3">
          <h4 id="evidence-results-heading" className="mb-2 text-xs font-medium text-neutral-700">
            Evidence for this claim
          </h4>
          <p className="mb-2 text-[11px] italic text-neutral-600">“{activeClaim.claim_text}”</p>

          {stage === "searching" && (
            <p role="status" aria-live="polite" className="text-[11px] text-neutral-500">
              Searching your sources…
            </p>
          )}

          {stage !== "searching" && searchOutcome === "no_evidence_found" && (
            <div className="text-[11px] text-neutral-500">
              <p className="mb-1">No evidence found in your sources for this claim.</p>
              <p>Upload a source that covers it, or soften the claim to what your sources do show.</p>
            </div>
          )}

          {stage !== "searching" && candidates && candidates.length > 0 && (
            <div className="space-y-2">
              {candidates.map((candidate) => (
                <EvidenceCard
                  key={candidate.chunk.id}
                  model={toCardModel(candidate)}
                  selected={selected?.chunk.id === candidate.chunk.id}
                  onUse={
                    candidate.citation
                      ? () => {
                          setSelected(candidate);
                          setConfirmation(null);
                        }
                      : undefined
                  }
                  onViewSource={
                    candidate.citation && onOpenSource
                      ? ((citationId) => () => onOpenSource(citationId))(candidate.citation.id)
                      : undefined
                  }
                />
              ))}
              {candidates.some((c) => !c.citation) && (
                <p className="text-[11px] text-neutral-500">
                  Excerpts from documents that are not linked to a source cannot be cited. Link the document to a
                  source in Documents first.
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* --- Step 3: preview, then insert ------------------------------ */}
      {activeClaim && selected && (
        <EvidenceInsertPreview
          claimText={activeClaim.claim_text}
          evidence={toCardModel(selected)}
          busy={stage === "inserting"}
          error={null}
          onInsert={insert}
          onCancel={() => setSelected(null)}
        />
      )}
    </div>
  );
}
