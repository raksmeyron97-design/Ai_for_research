"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AICopilot from "@/components/AICopilot";
import DataAnalysisPanel from "@/components/DataAnalysisPanel";
import DocumentsPanel from "@/components/DocumentsPanel";
import EvidencePanel, { type EvidenceRequest } from "@/components/EvidencePanel";
import LiteratureWorkspace, { type LiteratureTab } from "@/components/LiteratureWorkspace";
import MethodologyWorkspace from "@/components/MethodologyWorkspace";
import QualityCheckPanel from "@/components/QualityCheckPanel";
import QuestionnaireBuilder from "@/components/QuestionnaireBuilder";
import ResearchIntegrityWorkspace from "@/components/ResearchIntegrityWorkspace";
import ResearchNavigator from "@/components/ResearchNavigator";
import SectionHistoryPane from "@/components/SectionHistoryPane";
import SectionReviewPane from "@/components/SectionReviewPane";
import WorkspacePanes, { type WorkspacePane } from "@/components/WorkspacePanes";
import SectionEditor from "@/components/SectionEditor";
import { SECTION_CHAIN } from "@/lib/db/types";
import type { ClaimLocation } from "@/lib/integrity/claim-location";
import type {
  ResearchClaimRow,
  ResearchDocumentRow,
  ResearchProjectRow,
  ResearchSectionRow,
  SectionStatus,
  SectionType,
} from "@/lib/db/types";

function buildSectionsMap(sections: ResearchSectionRow[]): Partial<Record<SectionType, ResearchSectionRow>> {
  const map: Partial<Record<SectionType, ResearchSectionRow>> = {};
  for (const section of sections) map[section.section_type] = section;
  return map;
}

function firstIncompleteSection(map: Partial<Record<SectionType, ResearchSectionRow>>): SectionType {
  return SECTION_CHAIN.find((s) => map[s]?.status !== "completed") ?? SECTION_CHAIN[0];
}

/**
 * The workspace shell.
 *
 * It owns the state the panes share — which section is open, what the editor
 * has, what the Evidence pane has been asked to work on — because those are
 * genuinely shared: a review issue's "Find evidence" has to reach the Evidence
 * pane, and an insertion has to reach the editor. Everything else stays inside
 * its own pane.
 *
 * §27's requirement is that the researcher never loses their editing context.
 * That is why Evidence and Review are panes beside the editor rather than
 * pages, and why the Literature workspace opens over the top: closing it puts
 * the researcher back on the same paragraph, because the editor never
 * unmounted.
 */
export default function ProjectWorkspace({
  project,
  initialSections,
  initialDocuments,
}: {
  project: ResearchProjectRow;
  initialSections: ResearchSectionRow[];
  initialDocuments: ResearchDocumentRow[];
}) {
  const [sectionsMap, setSectionsMap] = useState(() => buildSectionsMap(initialSections));
  const [activeSectionType, setActiveSectionType] = useState<SectionType>(() =>
    firstIncompleteSection(buildSectionsMap(initialSections)),
  );
  const [documents, setDocuments] = useState(initialDocuments);
  const [showDocuments, setShowDocuments] = useState(false);
  const [showQualityCheck, setShowQualityCheck] = useState(false);
  const [literature, setLiterature] = useState<{ tab: LiteratureTab; sourceId?: string } | null>(null);
  const [showMethodology, setShowMethodology] = useState(false);
  const [showIntegrity, setShowIntegrity] = useState(false);
  const [exportGate, setExportGate] = useState<{
    format: "docx" | "pdf" | "md";
    warnings: { id: string; title: string }[];
  } | null>(null);
  const [insertRequest, setInsertRequest] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

  const [asidePane, setAsidePane] = useState("assistant");
  const [evidenceRequest, setEvidenceRequest] = useState<EvidenceRequest | null>(null);
  /**
   * Content the server saved (an insertion or a restore), handed to the editor
   * without a re-save. The nonce is what makes a repeat of identical content
   * still apply.
   */
  const [externalUpdate, setExternalUpdate] = useState<{ content: string; nonce: number } | null>(null);
  /** Bumped to make the Review and History panes refetch (§28, §29). */
  const [refreshToken, setRefreshToken] = useState(0);
  // A claim to find and select in the editor, and where that ended up (§13).
  const [highlightClaim, setHighlightClaim] = useState<{
    claim: ResearchClaimRow;
    nonce: number;
  } | null>(null);
  const [highlightResult, setHighlightResult] = useState<ClaimLocation | null>(null);

  const statuses = useMemo(() => {
    const result = {} as Record<SectionType, SectionStatus>;
    for (const sectionType of SECTION_CHAIN) {
      result[sectionType] = sectionsMap[sectionType]?.status ?? "not_started";
    }
    return result;
  }, [sectionsMap]);

  const percentComplete = useMemo(() => {
    const completed = SECTION_CHAIN.filter((s) => statuses[s] === "completed").length;
    return Math.round((completed / SECTION_CHAIN.length) * 100);
  }, [statuses]);

  function applyServerContent(content: string) {
    setExternalUpdate((prev) => ({ content, nonce: (prev?.nonce ?? 0) + 1 }));
    setSectionsMap((prev) => {
      const existing = prev[activeSectionType];
      return existing ? { ...prev, [activeSectionType]: { ...existing, content } } : prev;
    });
    // The review recounts rows rather than being told a new number, so an
    // insertion improves evidence coverage only if it really created the
    // relation (§28).
    setRefreshToken((n) => n + 1);
  }

  /**
   * The pre-export integrity gate (§37). Warns, never blocks — a gate-check
   * failure or a slow response must not be able to prevent an export, so
   * both fall through to exporting directly rather than surfacing an error.
   * Only genuine warnings pause the download, and only with a confirm step
   * the researcher can dismiss.
   */
  async function triggerExport(format: "docx" | "pdf" | "md") {
    setShowExportMenu(false);
    const exportUrl = `/api/research/projects/${project.id}/export?format=${format}`;
    try {
      const res = await fetch(`/api/research/projects/${project.id}/integrity/gate`);
      if (res.ok) {
        const body = await res.json();
        if (Array.isArray(body.warnings) && body.warnings.length > 0) {
          setExportGate({ format, warnings: body.warnings });
          return;
        }
      }
    } catch {
      // A gate check that fails should not block an export the researcher
      // can otherwise complete.
    }
    window.location.href = exportUrl;
  }

  /**
   * §13: when a claim cannot be found, say so. Silently doing nothing after
   * the researcher clicked "Show in manuscript" reads as a broken button, and
   * the honest answer — the sentence has been edited since the claim was
   * extracted — is information they need before trusting any other finding
   * about that claim.
   */
  const highlightNotice =
    highlightResult && highlightResult.outcome !== "located" ? (
      <div
        role="status"
        className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
      >
        <span className="font-medium">Could not highlight that sentence. </span>
        {highlightResult.explanation}
        <button
          type="button"
          onClick={() => setHighlightResult(null)}
          className="ml-2 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-700"
        >
          Dismiss
        </button>
      </div>
    ) : null;

  const editorPane =
    activeSectionType === "questionnaire" ? (
      <QuestionnaireBuilder projectId={project.id} />
    ) : activeSectionType === "data_analysis" ? (
      <DataAnalysisPanel projectId={project.id} />
    ) : (
      <SectionEditor
        key={activeSectionType}
        projectId={project.id}
        sectionType={activeSectionType}
        initialSection={sectionsMap[activeSectionType]}
        onSaved={(section) => {
          setSectionsMap((prev) => ({ ...prev, [section.section_type]: section }));
          setRefreshToken((n) => n + 1);
        }}
        insertRequest={insertRequest}
        onInsertConsumed={() => setInsertRequest(null)}
        externalUpdate={externalUpdate}
        onFindEvidence={(passage, offset) => {
          setEvidenceRequest((prev) => ({ passage, passageOffset: offset, nonce: (prev?.nonce ?? 0) + 1 }));
          setAsidePane("evidence");
        }}
        highlightClaim={
          highlightClaim && highlightClaim.claim.section_type === activeSectionType
            ? highlightClaim
            : null
        }
        onHighlightResolved={setHighlightResult}
      />
    );

  const editorPaneWithNotice = (
    <div className="flex min-h-0 flex-1 flex-col">
      {highlightNotice}
      {editorPane}
    </div>
  );

  const panes: WorkspacePane[] = [
    {
      id: "navigator",
      label: "Sections",
      region: "navigator",
      node: (
        <ResearchNavigator
          statuses={statuses}
          activeSectionType={activeSectionType}
          onSelect={setActiveSectionType}
        />
      ),
    },
    { id: "editor", label: "Editor", region: "editor", node: editorPaneWithNotice },
    {
      id: "review",
      label: "Review",
      region: "aside",
      node: (
        <SectionReviewPane
          key={activeSectionType}
          projectId={project.id}
          sectionType={activeSectionType}
          refreshToken={refreshToken}
          onIssueAction={(issue) => {
            if (issue.action === "find_evidence") {
              setEvidenceRequest((prev) => ({ claimId: issue.claimId, nonce: (prev?.nonce ?? 0) + 1 }));
              setAsidePane("evidence");
            } else if (issue.action === "verify_citation") {
              setLiterature({ tab: "sources" });
            } else if (issue.action === "write_content") {
              setAsidePane("assistant");
            }
          }}
        />
      ),
    },
    {
      id: "evidence",
      label: "Evidence",
      region: "aside",
      node: (
        <EvidencePanel
          key={activeSectionType}
          projectId={project.id}
          sectionType={activeSectionType}
          request={evidenceRequest}
          onInserted={({ content }) => applyServerContent(content)}
          onOpenSource={(sourceId) => setLiterature({ tab: "sources", sourceId })}
        />
      ),
    },
    {
      id: "assistant",
      label: "AI Assist",
      region: "aside",
      node: (
        <AICopilot
          projectId={project.id}
          sectionType={activeSectionType}
          onInsert={(text) => setInsertRequest(text)}
        />
      ),
    },
    {
      id: "history",
      label: "History",
      region: "aside",
      node: (
        <SectionHistoryPane
          key={activeSectionType}
          projectId={project.id}
          sectionType={activeSectionType}
          refreshToken={refreshToken}
          onRestored={(section) => {
            setSectionsMap((prev) => ({ ...prev, [section.section_type]: section }));
            applyServerContent(section.content);
          }}
        />
      ),
    },
  ];

  return (
    <div className="flex h-screen flex-col">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-200 px-4 py-3">
        <div className="min-w-0">
          <Link href="/dashboard" className="text-xs text-neutral-500 hover:underline">
            ← All projects
          </Link>
          <h1 className="truncate font-medium">{project.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <span className="text-xs text-neutral-500">{percentComplete}% complete</span>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowExportMenu((v) => !v)}
              className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
            >
              Export
            </button>
            {showExportMenu && (
              <div className="absolute right-0 z-10 mt-1 w-40 rounded border border-neutral-200 bg-white py-1 shadow-lg">
                {(["docx", "pdf", "md"] as const).map((format) => (
                  <button
                    key={format}
                    type="button"
                    onClick={() => void triggerExport(format)}
                    className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-50"
                  >
                    {format === "docx" ? "Word (.docx)" : format === "pdf" ? "PDF" : "Markdown (.md)"}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowMethodology(true)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Methodology
          </button>
          <button
            type="button"
            onClick={() => setLiterature({ tab: "sources" })}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Literature
          </button>
          <button
            type="button"
            onClick={() => setShowIntegrity(true)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Research Integrity
          </button>
          <button
            type="button"
            onClick={() => setShowQualityCheck(true)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Quality Check
          </button>
          <button
            type="button"
            onClick={() => setShowDocuments(true)}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Documents ({documents.length})
          </button>
        </div>
      </header>

      <WorkspacePanes panes={panes} activeAside={asidePane} onAsideChange={setAsidePane} />

      {showDocuments && (
        <DocumentsPanel
          projectId={project.id}
          documents={documents}
          onDocumentsChange={setDocuments}
          onClose={() => setShowDocuments(false)}
        />
      )}

      {showQualityCheck && (
        <QualityCheckPanel projectId={project.id} onClose={() => setShowQualityCheck(false)} />
      )}

      {showMethodology && (
        <MethodologyWorkspace projectId={project.id} onClose={() => setShowMethodology(false)} />
      )}

      {literature && (
        <LiteratureWorkspace
          projectId={project.id}
          initialTab={literature.tab}
          initialSourceId={literature.sourceId ?? null}
          onClose={() => setLiterature(null)}
          onGoToSection={(section) => setActiveSectionType(section)}
        />
      )}

      {exportGate && (
        <div role="alertdialog" aria-label="Research integrity warnings" className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded bg-white p-4 text-sm shadow-lg">
            <p className="mb-2 font-medium">
              {exportGate.warnings.length} research integrity warning{exportGate.warnings.length === 1 ? "" : "s"}
            </p>
            <ul className="mb-3 max-h-40 space-y-1 overflow-y-auto text-xs text-neutral-600">
              {exportGate.warnings.slice(0, 8).map((w) => (
                <li key={w.id}>{w.title}</li>
              ))}
            </ul>
            <p className="mb-3 text-xs text-neutral-500">
              You can export anyway — this only flags things worth a look, it does not stop you.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setExportGate(null)}
                className="rounded border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-50"
              >
                Cancel
              </button>
              <a
                href={`/api/research/projects/${project.id}/export?format=${exportGate.format}`}
                onClick={() => setExportGate(null)}
                className="rounded bg-neutral-900 px-3 py-1.5 text-xs text-white hover:bg-neutral-800"
              >
                Export anyway
              </a>
            </div>
          </div>
        </div>
      )}

      {showIntegrity && (
        <ResearchIntegrityWorkspace
          projectId={project.id}
          onClose={() => setShowIntegrity(false)}
          onGoToSection={(section, claim) => {
            setActiveSectionType(section);
            setHighlightResult(null);
            if (claim) setHighlightClaim((prev) => ({ claim, nonce: (prev?.nonce ?? 0) + 1 }));
          }}
          onFindEvidence={(claim) => {
            setActiveSectionType(claim.section_type);
            setAsidePane("evidence");
            setEvidenceRequest((prev) => ({ claimId: claim.id, nonce: (prev?.nonce ?? 0) + 1 }));
            setShowIntegrity(false);
          }}
        />
      )}
    </div>
  );
}
