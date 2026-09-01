"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AICopilot from "@/components/AICopilot";
import DataAnalysisPanel from "@/components/DataAnalysisPanel";
import DocumentsPanel from "@/components/DocumentsPanel";
import EvidencePanel, { type EvidenceRequest } from "@/components/EvidencePanel";
import LiteratureWorkspace, { type LiteratureTab } from "@/components/LiteratureWorkspace";
import QualityCheckPanel from "@/components/QualityCheckPanel";
import QuestionnaireBuilder from "@/components/QuestionnaireBuilder";
import ResearchNavigator from "@/components/ResearchNavigator";
import SectionHistoryPane from "@/components/SectionHistoryPane";
import SectionReviewPane from "@/components/SectionReviewPane";
import WorkspacePanes, { type WorkspacePane } from "@/components/WorkspacePanes";
import SectionEditor from "@/components/SectionEditor";
import { SECTION_CHAIN } from "@/lib/db/types";
import type {
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
      />
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
    { id: "editor", label: "Editor", region: "editor", node: editorPane },
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
                  <a
                    key={format}
                    href={`/api/research/projects/${project.id}/export?format=${format}`}
                    onClick={() => setShowExportMenu(false)}
                    className="block px-3 py-1.5 text-sm hover:bg-neutral-50"
                  >
                    {format === "docx" ? "Word (.docx)" : format === "pdf" ? "PDF" : "Markdown (.md)"}
                  </a>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setLiterature({ tab: "sources" })}
            className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Literature
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

      {literature && (
        <LiteratureWorkspace
          projectId={project.id}
          initialTab={literature.tab}
          initialSourceId={literature.sourceId ?? null}
          onClose={() => setLiterature(null)}
          onGoToSection={(section) => setActiveSectionType(section)}
        />
      )}
    </div>
  );
}
