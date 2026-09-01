"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import AICopilot from "@/components/AICopilot";
import DataAnalysisPanel from "@/components/DataAnalysisPanel";
import DocumentsPanel from "@/components/DocumentsPanel";
import QualityCheckPanel from "@/components/QualityCheckPanel";
import QuestionnaireBuilder from "@/components/QuestionnaireBuilder";
import ResearchNavigator from "@/components/ResearchNavigator";
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
  const [insertRequest, setInsertRequest] = useState<string | null>(null);
  const [showExportMenu, setShowExportMenu] = useState(false);

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

  return (
    <div className="flex h-screen flex-col">
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <div className="min-w-0">
          <Link href="/dashboard" className="text-xs text-neutral-500 hover:underline">
            ← All projects
          </Link>
          <h1 className="truncate font-medium">{project.title}</h1>
        </div>
        <div className="flex items-center gap-4">
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

      <div className="grid min-h-0 flex-1 grid-cols-[220px_1fr_360px]">
        <div className="min-h-0 border-r border-neutral-200">
          <ResearchNavigator
            statuses={statuses}
            activeSectionType={activeSectionType}
            onSelect={setActiveSectionType}
          />
        </div>

        <div className="min-h-0">
          {activeSectionType === "questionnaire" ? (
            <QuestionnaireBuilder projectId={project.id} />
          ) : activeSectionType === "data_analysis" ? (
            <DataAnalysisPanel projectId={project.id} />
          ) : (
            <SectionEditor
              key={activeSectionType}
              projectId={project.id}
              sectionType={activeSectionType}
              initialSection={sectionsMap[activeSectionType]}
              onSaved={(section) =>
                setSectionsMap((prev) => ({ ...prev, [section.section_type]: section }))
              }
              insertRequest={insertRequest}
              onInsertConsumed={() => setInsertRequest(null)}
            />
          )}
        </div>

        <div className="min-h-0 border-l border-neutral-200">
          <AICopilot
            projectId={project.id}
            sectionType={activeSectionType}
            onInsert={(text) => setInsertRequest(text)}
          />
        </div>
      </div>

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
    </div>
  );
}
