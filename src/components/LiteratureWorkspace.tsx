"use client";

import { useEffect, useState } from "react";
import { useDialogOverlay } from "@/lib/ui/use-dialog-overlay";
import EvidenceCard, { type EvidenceCardModel } from "@/components/EvidenceCard";
import ResearchGapMatrix from "@/components/ResearchGapMatrix";
import SourceComparison from "@/components/SourceComparison";
import SourceDetailPanel from "@/components/SourceDetailPanel";
import SourceSearchPanel from "@/components/SourceSearchPanel";
import ThemeManager from "@/components/ThemeManager";
import type {
  ResearchCitationRow,
  ResearchEvidenceRow,
  ResearchSourceProfileRow,
  SectionType,
} from "@/lib/db/types";

/**
 * The literature workspace (§25).
 *
 * Sources, Evidence, Themes, Compare and Research gaps are one surface with
 * one selection, not five pages. §25's rule is the point: a researcher who
 * ticks four studies in Compare and moves to Research gaps is thinking about
 * the same four studies, and making them re-tick the boxes is the tool losing
 * the thread rather than the researcher.
 *
 * It opens over the workspace instead of navigating away, so the editor stays
 * mounted underneath and closing returns the researcher to the paragraph they
 * left (§27).
 */
export type LiteratureTab = "sources" | "evidence" | "themes" | "compare" | "gaps";

const TABS: { id: LiteratureTab; label: string }[] = [
  { id: "sources", label: "Sources" },
  { id: "evidence", label: "Evidence" },
  { id: "themes", label: "Themes" },
  { id: "compare", label: "Compare" },
  { id: "gaps", label: "Research gaps" },
];

export default function LiteratureWorkspace({
  projectId,
  initialTab = "sources",
  initialSourceId,
  onClose,
  onGoToSection,
}: {
  projectId: string;
  initialTab?: LiteratureTab;
  /** Opens straight into one source's detail, e.g. from an evidence card. */
  initialSourceId?: string | null;
  onClose: () => void;
  onGoToSection?: (section: SectionType) => void;
}) {
  const [tab, setTab] = useState<LiteratureTab>(initialTab);
  const [citations, setCitations] = useState<ResearchCitationRow[]>([]);
  const [profiles, setProfiles] = useState<ResearchSourceProfileRow[]>([]);
  const [evidence, setEvidence] = useState<ResearchEvidenceRow[] | null>(null);
  // Shared across Compare and Research gaps — the whole reason these are tabs
  // of one workspace rather than separate pages.
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [openSourceId, setOpenSourceId] = useState<string | null>(initialSourceId ?? null);
  /** Set from the Themes tab. The id is what the server filters on; the name
   *  is only so the Sources tab can say which theme is applied. */
  const [themeFilter, setThemeFilter] = useState<{ id: string; name: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  /**
   * The whole citation list, for the tabs that genuinely need one (§32).
   *
   * Sources no longer does: it searches and pages on the server. Themes,
   * Compare and Research gaps are pickers over the library, and Evidence
   * needs the lookup to name each excerpt's source — so the fetch is deferred
   * until one of those is opened rather than paid for on the default tab.
   *
   * Loaded once and kept: switching between those four tabs is not a reason
   * to re-fetch, and the selection they share would flicker if it were.
   */
  const [citationsLoaded, setCitationsLoaded] = useState(false);

  useEffect(() => {
    if (tab === "sources" || citationsLoaded) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/research/projects/${projectId}/citations`);
        if (!res.ok) throw new Error("Your sources could not be loaded.");
        const body = await res.json();
        if (cancelled) return;
        setCitations(body.citations ?? []);
        setCitationsLoaded(true);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    // Cancelled on unmount and on a tab change, so a response arriving after
    // the researcher moved on does not write state behind them (§51).
    return () => {
      cancelled = true;
    };
  }, [tab, citationsLoaded, projectId]);

  // Evidence is fetched only when its tab is opened (§38) — a project with
  // hundreds of excerpts should not pay for them to open the Sources list.
  useEffect(() => {
    if (tab !== "evidence" || evidence !== null) return;
    (async () => {
      try {
        const res = await fetch(`/api/research/projects/${projectId}/evidence`);
        if (!res.ok) throw new Error("Saved evidence could not be loaded.");
        const body = await res.json();
        setEvidence(body.evidence ?? []);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  }, [tab, evidence, projectId]);

  useEffect(() => {
    if (tab !== "gaps" || selectedIds.length === 0) return;
    (async () => {
      try {
        const res = await fetch(`/api/research/projects/${projectId}/literature/compare`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            citationIds: selectedIds.slice(0, 5),
            extractMissing: false,
            withNotes: false,
          }),
        });
        if (!res.ok) return;
        const body = await res.json();
        // Reuse the comparison's columns as the matrix's known facts rather
        // than adding a route that returns the same rows a second way.
        setProfiles(
          (body.comparison.columns as { citationId: string; cells: { field: string; value: string | null }[] }[])
            .filter((col) => col.cells.some((c) => c.value))
            .map(
              (col) =>
                ({
                  id: col.citationId,
                  project_id: projectId,
                  citation_id: col.citationId,
                  population: col.cells.find((c) => c.field === "population")?.value ?? null,
                  study_design: col.cells.find((c) => c.field === "study_design")?.value ?? null,
                  sample: col.cells.find((c) => c.field === "sample")?.value ?? null,
                  variables: col.cells.find((c) => c.field === "variables")?.value ?? null,
                  main_finding: col.cells.find((c) => c.field === "main_finding")?.value ?? null,
                  limitations: col.cells.find((c) => c.field === "limitations")?.value ?? null,
                  relevance: col.cells.find((c) => c.field === "relevance")?.value ?? null,
                  field_provenance: {},
                  created_at: "",
                  updated_at: "",
                }) as ResearchSourceProfileRow,
            ),
        );
      } catch {
        // The matrix renders study rows without profiles rather than failing.
      }
    })();
  }, [tab, selectedIds, projectId]);

  const citationById = new Map(citations.map((c) => [c.id, c]));

  function evidenceModel(row: ResearchEvidenceRow): EvidenceCardModel {
    const citation = citationById.get(row.citation_id);
    return {
      id: row.id,
      sourceTitle: citation?.title ?? null,
      authors: citation?.authors ?? [],
      year: citation?.year ?? null,
      sourceType: citation?.source_type ?? null,
      tier: citation?.tier ?? null,
      citationKey: citation?.citation_key ?? null,
      sourceStatus: citation?.status ?? null,
      excerpt: row.excerpt,
      page: row.page,
      sectionLabel: row.section_label,
      relevance: row.relevance_note ?? "Saved from your sources.",
      saved: true,
    };
  }

  // §33: dialog semantics — focus moves in, is trapped, and returns to
  // whatever opened this when it closes. Escape closes.
  const overlayRef = useDialogOverlay(onClose);

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Literature"
      className="fixed inset-0 z-20 flex flex-col bg-white"
    >
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <h2 className="text-sm font-medium">Literature</h2>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Back to writing
        </button>
      </header>

      <div role="tablist" aria-label="Literature workspace" className="flex overflow-x-auto border-b border-neutral-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`lit-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`lit-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => {
              setTab(t.id);
              setOpenSourceId(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const i = TABS.findIndex((x) => x.id === tab);
              const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
              setTab(TABS[next].id);
              document.getElementById(`lit-tab-${TABS[next].id}`)?.focus();
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
        ) : (
          <>
            <div role="tabpanel" id="lit-panel-sources" aria-labelledby="lit-tab-sources" hidden={tab !== "sources"}>
              <SourceSearchPanel
                projectId={projectId}
                themeFilter={themeFilter}
                onClearThemeFilter={() => setThemeFilter(null)}
                onOpenSource={setOpenSourceId}
              />
            </div>

            <div role="tabpanel" id="lit-panel-evidence" aria-labelledby="lit-tab-evidence" hidden={tab !== "evidence"}>
              {evidence === null ? (
                <p className="text-xs text-neutral-500">Loading evidence…</p>
              ) : evidence.length === 0 ? (
                <div className="rounded border border-neutral-200 p-4 text-center text-xs">
                  <p className="mb-1 text-neutral-600">No evidence saved in this project yet.</p>
                  <p className="text-[11px] text-neutral-500">
                    Select a paragraph in a section and choose Find evidence to start.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {evidence.map((row) => (
                    <EvidenceCard
                      key={row.id}
                      model={evidenceModel(row)}
                      onViewSource={() => setOpenSourceId(row.citation_id)}
                    />
                  ))}
                </div>
              )}
            </div>

            <div role="tabpanel" id="lit-panel-themes" aria-labelledby="lit-tab-themes" hidden={tab !== "themes"}>
              <ThemeManager
                projectId={projectId}
                citations={citations}
                onFilter={(theme) => {
                  // The theme id, not the list of assigned citation ids: the
                  // filter is now a database predicate rather than an array
                  // the browser intersects with a fully loaded library.
                  setThemeFilter(theme);
                  setTab("sources");
                }}
              />
            </div>

            <div role="tabpanel" id="lit-panel-compare" aria-labelledby="lit-tab-compare" hidden={tab !== "compare"}>
              <SourceComparison
                projectId={projectId}
                citations={citations}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
              />
            </div>

            <div role="tabpanel" id="lit-panel-gaps" aria-labelledby="lit-tab-gaps" hidden={tab !== "gaps"}>
              <ResearchGapMatrix
                projectId={projectId}
                citations={citations}
                profiles={profiles}
                selectedIds={selectedIds}
                onSelectionChange={setSelectedIds}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
