"use client";

import { useCallback, useEffect, useState } from "react";
import SourceDetailPanel from "@/components/SourceDetailPanel";
import type { ResearchCitationRow, ResearchClaimRow, SectionType } from "@/lib/db/types";

/**
 * The research integrity workspace (§31).
 *
 * Overlays the workspace rather than navigating away, the same way
 * Methodology and Literature do — this is project-wide and cross-cutting,
 * not scoped to one section, so it does not belong inside the WorkspacePanes
 * grid as an aside pane.
 *
 * Every tab reads from the one deterministic review (`GET .../integrity/review`)
 * wherever possible, so nothing here re-derives a finding the backend already
 * computed. Findings are never stored as truth on this side either — closing
 * and reopening the workspace, or any action that changes a claim/citation/
 * evidence row, re-fetches the review from scratch.
 */
export type IntegrityTab =
  | "overview" | "claims" | "citations" | "evidence" | "sources"
  | "references" | "methodology" | "conflicts" | "findings";

const TABS: { id: IntegrityTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "claims", label: "Claims" },
  { id: "citations", label: "Citations" },
  { id: "evidence", label: "Evidence" },
  { id: "sources", label: "Sources" },
  { id: "references", label: "References" },
  { id: "methodology", label: "Methodology" },
  { id: "conflicts", label: "Conflicts" },
  { id: "findings", label: "Review Findings" },
];

export interface IntegrityMetric {
  id: string;
  label: string;
  value: number | null;
  status: "ok" | "attention" | "incomplete" | "not_computable";
  reason: string;
  evidence?: { covered: number; total: number };
}

export interface IntegrityFinding {
  id: string;
  category: "citation" | "evidence" | "source" | "reference" | "methodology" | "numerical" | "provenance";
  severity: "info" | "warning" | "error";
  title: string;
  explanation: string;
  targetType: string;
  targetId: string;
  provenance: "deterministic" | "ai_suggested";
  remediation?: string;
}

interface IntegrityDecision {
  id: string;
  finding_id: string;
  status: "open" | "reviewing" | "accepted" | "dismissed" | "resolved_manually";
  note: string | null;
}

interface ResearchIntegrityReview {
  projectId: string;
  metrics: IntegrityMetric[];
  findings: IntegrityFinding[];
  coverage: {
    citation: { requiringEvidence: number; cited: number; linkedToEvidence: number; linkedToResolvableSource: number };
    evidence: {
      requiring: number;
      supported: number;
      partiallySupported: number;
      unsupported: number;
      needsVerification: number;
      coverage: number | null;
      explanation: string;
    };
  };
  decisions: Record<string, IntegrityDecision>;
  generatedAt: string;
}

interface SourceConflictEntry {
  citationId: string;
  citationKey: string;
  evidenceId: string;
  support: "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "NEEDS_REVIEW";
  excerpt: string;
}
interface SourceConflictView {
  claimId: string;
  entries: SourceConflictEntry[];
  hasConflict: boolean;
}

const SEVERITY_STYLE: Record<IntegrityFinding["severity"], string> = {
  error: "border-red-300 bg-red-50 text-red-900",
  warning: "border-amber-300 bg-amber-50 text-amber-900",
  info: "border-neutral-300 bg-neutral-50 text-neutral-700",
};

const METRIC_BAR: Record<IntegrityMetric["status"], string> = {
  ok: "bg-green-500",
  attention: "bg-amber-500",
  incomplete: "bg-red-500",
  not_computable: "bg-neutral-200",
};

function pct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

function DecisionActions({
  findingId,
  decision,
  onDecide,
}: {
  findingId: string;
  decision?: IntegrityDecision;
  onDecide: (findingId: string, status: IntegrityDecision["status"]) => void;
}) {
  const status = decision?.status ?? "open";
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-wide text-neutral-500">Status: {status}</span>
      {status !== "reviewing" && (
        <button type="button" onClick={() => onDecide(findingId, "reviewing")} className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50">
          Mark reviewed
        </button>
      )}
      {status !== "accepted" && (
        <button type="button" onClick={() => onDecide(findingId, "accepted")} className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50">
          Accept finding
        </button>
      )}
      {status !== "dismissed" && (
        <button type="button" onClick={() => onDecide(findingId, "dismissed")} className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50">
          Dismiss
        </button>
      )}
      {status !== "resolved_manually" && (
        <button type="button" onClick={() => onDecide(findingId, "resolved_manually")} className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50">
          Resolve manually
        </button>
      )}
    </div>
  );
}

function FindingRow({
  finding,
  decision,
  onDecide,
}: {
  finding: IntegrityFinding;
  decision?: IntegrityDecision;
  onDecide: (findingId: string, status: IntegrityDecision["status"]) => void;
}) {
  const dismissed = decision?.status === "dismissed";
  return (
    <li className={`rounded border p-2 text-xs ${SEVERITY_STYLE[finding.severity]} ${dismissed ? "opacity-60" : ""}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">{finding.title}</span>
        <span className="flex items-center gap-1.5">
          {dismissed && <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] text-neutral-700">Dismissed</span>}
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
              finding.provenance === "ai_suggested" ? "bg-purple-100 text-purple-800" : "bg-neutral-200 text-neutral-700"
            }`}
          >
            {finding.provenance === "ai_suggested" ? "AI Suggested" : "Deterministic"}
          </span>
        </span>
      </div>
      <p className="mt-1">{finding.explanation}</p>
      {finding.remediation && <p className="mt-1 text-neutral-500">{finding.remediation}</p>}
      <DecisionActions findingId={finding.id} decision={decision} onDecide={onDecide} />
    </li>
  );
}

export default function ResearchIntegrityWorkspace({
  projectId,
  initialTab = "overview",
  onClose,
  onGoToSection,
  onFindEvidence,
  onEditCitation,
}: {
  projectId: string;
  initialTab?: IntegrityTab;
  onClose: () => void;
  /**
   * Phase 19 could only name the section. §13 asks for the sentence, so the
   * claim travels with the request and the editor locates it — or reports
   * `claim_not_located`, which is a real answer rather than a failure.
   */
  onGoToSection?: (section: SectionType, claim?: ResearchClaimRow) => void;
  /** Optional: wired by the caller to the existing evidence-search UI. The button renders only when given. */
  onFindEvidence?: (claim: ResearchClaimRow) => void;
  /** Optional: wired by the caller to the existing citation editor. The button renders only when given. */
  onEditCitation?: (claim: ResearchClaimRow) => void;
}) {
  const [tab, setTab] = useState<IntegrityTab>(initialTab);
  const [review, setReview] = useState<ResearchIntegrityReview | null>(null);
  const [claims, setClaims] = useState<ResearchClaimRow[] | null>(null);
  const [citations, setCitations] = useState<ResearchCitationRow[] | null>(null);
  const [conflicts, setConflicts] = useState<SourceConflictView[] | null>(null);
  const [openSourceId, setOpenSourceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiProposals, setAiProposals] = useState<{ citationKey: string; rationale: string }[] | null>(null);

  const loadReview = useCallback(async () => {
    try {
      const res = await fetch(`/api/research/projects/${projectId}/integrity/review`);
      if (!res.ok) throw new Error("The research integrity review could not be loaded.");
      const body = await res.json();
      setReview(body.review);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [projectId]);

  useEffect(() => {
    void loadReview();
  }, [loadReview]);

  useEffect(() => {
    if (tab !== "claims" || claims !== null) return;
    (async () => {
      try {
        const res = await fetch(`/api/research/projects/${projectId}/claims`);
        if (!res.ok) throw new Error("Claims could not be loaded.");
        const body = await res.json();
        setClaims(body.claims ?? []);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [tab, claims, projectId]);

  useEffect(() => {
    if ((tab !== "sources" && tab !== "references") || citations !== null) return;
    (async () => {
      try {
        const res = await fetch(`/api/research/projects/${projectId}/citations`);
        if (!res.ok) throw new Error("Sources could not be loaded.");
        const body = await res.json();
        setCitations(body.citations ?? []);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [tab, citations, projectId]);

  useEffect(() => {
    if (tab !== "conflicts" || conflicts !== null) return;
    (async () => {
      try {
        const res = await fetch(`/api/research/projects/${projectId}/integrity/conflicts`);
        if (!res.ok) throw new Error("Source conflicts could not be loaded.");
        const body = await res.json();
        setConflicts(body.conflicts ?? []);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [tab, conflicts, projectId]);

  async function decide(findingId: string, status: IntegrityDecision["status"]) {
    try {
      const res = await fetch(`/api/research/projects/${projectId}/integrity/decisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ findingId, status }),
      });
      if (!res.ok) throw new Error("That decision could not be saved.");
      const body = await res.json();
      setReview((prev) => (prev ? { ...prev, decisions: { ...prev.decisions, [findingId]: body.decision } } : prev));
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function suggestDuplicates() {
    setAiNote(null);
    setAiProposals(null);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/integrity/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "duplicate_references" }),
      });
      if (!res.ok) throw new Error("Duplicate suggestions could not be generated.");
      const body = await res.json();
      const byId = new Map((citations ?? []).map((c) => [c.id, c]));
      const pairs = Array.isArray(body?.proposals) ? body.proposals : [];
      setAiProposals(
        pairs.map((p: { aId: string; bId: string; rationale: string }) => ({
          citationKey: `${byId.get(p.aId)?.citation_key ?? p.aId} / ${byId.get(p.bId)?.citation_key ?? p.bId}`,
          rationale: p.rationale,
        })),
      );
      if (Array.isArray(body?.notes) && body.notes.length > 0) setAiNote(body.notes.join(" "));
      if (pairs.length === 0 && (!body?.notes || body.notes.length === 0)) {
        setAiNote("No likely duplicates found.");
      }
    } catch (err) {
      setAiNote((err as Error).message || "That suggestion could not be generated.");
    }
  }

  const findingsByTarget = new Map<string, IntegrityFinding[]>();
  for (const finding of review?.findings ?? []) {
    const list = findingsByTarget.get(finding.targetId) ?? [];
    list.push(finding);
    findingsByTarget.set(finding.targetId, list);
  }

  const goToTab = (id: IntegrityTab) => setTab(id);

  return (
    <div className="fixed inset-0 z-20 flex flex-col bg-white">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-medium">Research Integrity</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Back to writing
        </button>
      </header>

      <div role="tablist" aria-label="Research integrity workspace" className="flex overflow-x-auto border-b border-neutral-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`integrity-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`integrity-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => goToTab(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const i = TABS.findIndex((x) => x.id === tab);
              const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
              goToTab(TABS[next].id);
              document.getElementById(`integrity-tab-${TABS[next].id}`)?.focus();
            }}
            className={`shrink-0 px-4 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900 ${
              tab === t.id ? "border-b-2 border-neutral-900 font-medium" : "text-neutral-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <p role="alert" className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
            {error}
          </p>
        )}

        {openSourceId ? (
          <SourceDetailPanel
            projectId={projectId}
            citationId={openSourceId}
            onClose={() => setOpenSourceId(null)}
            onGoToSection={(section) => {
              onGoToSection?.(section);
              onClose();
            }}
          />
        ) : !review ? (
          <p className="text-xs text-neutral-500">Loading the research integrity review…</p>
        ) : (
          <>
            <div role="tabpanel" id="integrity-panel-overview" aria-labelledby="integrity-tab-overview" hidden={tab !== "overview"}>
              <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {review.metrics.map((metric) => (
                  <li key={metric.id}>
                    <button
                      type="button"
                      onClick={() => goToTab("findings")}
                      className="w-full rounded border border-neutral-200 p-2 text-left text-xs hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{metric.label}</span>
                        <span>{pct(metric.value)}</span>
                      </div>
                      <div className="mt-1 h-1.5 w-full rounded bg-neutral-100">
                        <div className={`h-1.5 rounded ${METRIC_BAR[metric.status]}`} style={{ width: metric.value === null ? "100%" : `${Math.round(metric.value * 100)}%` }} />
                      </div>
                      <p className="mt-1 text-neutral-500">{metric.reason}</p>
                    </button>
                  </li>
                ))}
              </ul>

              <div className="mt-4 rounded border border-neutral-200 p-2 text-xs">
                <p className="mb-1 font-medium">Citation completeness</p>
                <p>
                  {review.coverage.citation.requiringEvidence} claim(s) require evidence · {review.coverage.citation.cited} cited ·{" "}
                  {review.coverage.citation.linkedToEvidence} linked to evidence · {review.coverage.citation.linkedToResolvableSource} linked to a resolvable source
                </p>
              </div>

              <button type="button" onClick={() => goToTab("findings")} className="mt-4 rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">
                {review.findings.length} finding{review.findings.length === 1 ? "" : "s"} — review them
              </button>
            </div>

            <div role="tabpanel" id="integrity-panel-claims" aria-labelledby="integrity-tab-claims" hidden={tab !== "claims"}>
              {claims === null ? (
                <p className="text-xs text-neutral-500">Loading claims…</p>
              ) : claims.length === 0 ? (
                <p className="rounded border border-neutral-200 p-4 text-center text-xs text-neutral-600">No claims recorded in this project yet.</p>
              ) : (
                <ul className="space-y-2">
                  {claims.map((claim) => {
                    const claimFindings = findingsByTarget.get(claim.id) ?? [];
                    return (
                      <li key={claim.id} className="rounded border border-neutral-200 p-2 text-xs">
                        <p>{claim.claim_text}</p>
                        <p className="mt-1 text-neutral-500">
                          {claim.claim_type} · {claim.needs_evidence ? claim.evidence_status : "Not applicable — this claim type does not require evidence"}
                        </p>
                        {claimFindings.length === 0 ? (
                          claim.needs_evidence && <p className="mt-1 text-green-700">No open citation finding for this claim.</p>
                        ) : (
                          <ul className="mt-1 space-y-1">
                            {claimFindings.map((f) => (
                              <FindingRow key={f.id} finding={f} decision={review.decisions[f.id]} onDecide={decide} />
                            ))}
                          </ul>
                        )}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {onGoToSection && (
                            <button
                              type="button"
                              onClick={() => {
                                onGoToSection(claim.section_type, claim);
                                onClose();
                              }}
                              className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50"
                            >
                              Show in manuscript
                            </button>
                          )}
                          {onFindEvidence && (
                            <button type="button" onClick={() => onFindEvidence(claim)} className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50">
                              Find evidence
                            </button>
                          )}
                          {onEditCitation && (
                            <button type="button" onClick={() => onEditCitation(claim)} className="rounded border border-neutral-300 px-1.5 py-0.5 text-[11px] hover:bg-neutral-50">
                              Edit citation
                            </button>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            <div role="tabpanel" id="integrity-panel-citations" aria-labelledby="integrity-tab-citations" hidden={tab !== "citations"}>
              {review.findings.filter((f) => f.category === "citation").length === 0 ? (
                <p className="rounded border border-neutral-200 p-4 text-center text-xs text-neutral-600">No citation issues found.</p>
              ) : (
                <ul className="space-y-2">
                  {review.findings
                    .filter((f) => f.category === "citation")
                    .map((f) => (
                      <FindingRow key={f.id} finding={f} decision={review.decisions[f.id]} onDecide={decide} />
                    ))}
                </ul>
              )}
            </div>

            <div role="tabpanel" id="integrity-panel-evidence" aria-labelledby="integrity-tab-evidence" hidden={tab !== "evidence"}>
              <ul className="space-y-1 text-xs">
                <li>{review.coverage.evidence.explanation}</li>
                {review.coverage.evidence.requiring > 0 && (
                  <>
                    <li>Supported: {review.coverage.evidence.supported}</li>
                    <li>Partially supported: {review.coverage.evidence.partiallySupported}</li>
                    <li>Unsupported: {review.coverage.evidence.unsupported}</li>
                    <li>Needs verification: {review.coverage.evidence.needsVerification}</li>
                  </>
                )}
              </ul>
            </div>

            <div role="tabpanel" id="integrity-panel-sources" aria-labelledby="integrity-tab-sources" hidden={tab !== "sources"}>
              {citations === null ? (
                <p className="text-xs text-neutral-500">Loading sources…</p>
              ) : citations.length === 0 ? (
                <p className="rounded border border-neutral-200 p-4 text-center text-xs text-neutral-600">No sources saved yet.</p>
              ) : (
                <ul className="space-y-1">
                  {citations.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setOpenSourceId(c.id)}
                        className="w-full rounded border border-neutral-200 p-2 text-left text-xs hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                      >
                        <span className="font-medium">{c.title ?? c.citation_key}</span>
                        <span className="mt-0.5 block text-[11px] text-neutral-500">
                          <span className="font-mono">[{c.citation_key}]</span> · {c.status}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div role="tabpanel" id="integrity-panel-references" aria-labelledby="integrity-tab-references" hidden={tab !== "references"}>
              <button type="button" onClick={() => void suggestDuplicates()} className="mb-2 rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50">
                Suggest possible duplicates (AI)
              </button>
              {aiNote && <p className="mb-2 text-xs text-neutral-500">{aiNote}</p>}
              {aiProposals && aiProposals.length > 0 && (
                <ul className="mb-3 space-y-1">
                  {aiProposals.map((p, i) => (
                    <li key={i} className="rounded border border-purple-200 bg-purple-50 p-2 text-xs text-purple-900">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{p.citationKey}</span>
                        <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-purple-800">AI Suggested</span>
                      </div>
                      <p className="mt-1">{p.rationale}</p>
                    </li>
                  ))}
                </ul>
              )}

              {review.findings.filter((f) => f.category === "reference").length === 0 ? (
                <p className="rounded border border-neutral-200 p-4 text-center text-xs text-neutral-600">No reference issues found.</p>
              ) : (
                <ul className="space-y-2">
                  {review.findings
                    .filter((f) => f.category === "reference")
                    .map((f) => (
                      <FindingRow key={f.id} finding={f} decision={review.decisions[f.id]} onDecide={decide} />
                    ))}
                </ul>
              )}
            </div>

            <div role="tabpanel" id="integrity-panel-methodology" aria-labelledby="integrity-tab-methodology" hidden={tab !== "methodology"}>
              {review.findings.filter((f) => f.category === "methodology").length === 0 ? (
                <p className="rounded border border-neutral-200 p-4 text-center text-xs text-neutral-600">No methodology-consistency issues found.</p>
              ) : (
                <ul className="space-y-2">
                  {review.findings
                    .filter((f) => f.category === "methodology")
                    .map((f) => (
                      <FindingRow key={f.id} finding={f} decision={review.decisions[f.id]} onDecide={decide} />
                    ))}
                </ul>
              )}
            </div>

            <div role="tabpanel" id="integrity-panel-conflicts" aria-labelledby="integrity-tab-conflicts" hidden={tab !== "conflicts"}>
              {conflicts === null ? (
                <p className="text-xs text-neutral-500">Loading conflicts…</p>
              ) : conflicts.length === 0 ? (
                <p className="rounded border border-neutral-200 p-4 text-center text-xs text-neutral-600">No conflicting sources found.</p>
              ) : (
                <ul className="space-y-3">
                  {conflicts.map((c) => (
                    <li key={c.claimId} className="rounded border border-neutral-200 p-2 text-xs">
                      <p className="mb-1 font-medium">Claim {c.claimId}</p>
                      <ul className="space-y-1">
                        {c.entries.map((entry) => (
                          <li key={entry.evidenceId} className="rounded border border-neutral-100 bg-neutral-50 p-1.5">
                            <div className="flex items-center justify-between">
                              <span className="font-mono">[{entry.citationKey}]</span>
                              <span className="rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] font-medium">{entry.support}</span>
                            </div>
                            <p className="mt-1 text-neutral-600">{entry.excerpt}</p>
                          </li>
                        ))}
                      </ul>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div role="tabpanel" id="integrity-panel-findings" aria-labelledby="integrity-tab-findings" hidden={tab !== "findings"}>
              {review.findings.length === 0 ? (
                <p className="rounded border border-neutral-200 p-4 text-center text-xs text-neutral-600">
                  No findings — everything checked traces back to stored evidence, citations and methodology.
                </p>
              ) : (
                <ul className="space-y-2">
                  {review.findings.map((f) => (
                    <FindingRow key={f.id} finding={f} decision={review.decisions[f.id]} onDecide={decide} />
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
