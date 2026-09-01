/**
 * Provider-agnostic intermediate representation of an exportable thesis
 * document. Built once from the database (compileDocumentModel), then
 * rendered by to-markdown.ts / to-docx.ts / to-pdf.ts — each renderer only
 * has to understand this small block set, not the research-project schema.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { listCitations } from "../db/citations";
import { listInstruments } from "../db/instruments";
import { getProject } from "../db/projects";
import { listQuestions } from "../db/questions";
import { listSections } from "../db/sections";
import { SECTION_LABELS } from "../db/types";
import type { ResearchProjectRow, SectionType } from "../db/types";

export type DocBlock =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "paragraph"; text: string }
  | { type: "table"; headers: string[]; rows: string[][] }
  | { type: "pagebreak" };

export interface DocumentModel {
  title: string;
  project: ResearchProjectRow;
  blocks: DocBlock[];
}

const PLACEHOLDER = "[Not yet completed]";

/** Groups the 18-section chain into thesis chapters (spec §21), skipping the two sections that get their own dedicated treatment below (questionnaire, references). */
const CHAPTERS: { heading: string; sections: SectionType[] }[] = [
  { heading: "Chapter 1: Introduction", sections: ["research_problem", "rationale", "research_gap"] },
  {
    heading: "Chapter 2: Objectives and Conceptual Framework",
    sections: ["objectives", "research_questions", "variables", "conceptual_framework"],
  },
  { heading: "Chapter 3: Methodology", sections: ["methodology", "questionnaire", "data_collection", "data_analysis"] },
  { heading: "Chapter 4: Results", sections: ["results"] },
  { heading: "Chapter 5: Discussion", sections: ["discussion"] },
  { heading: "Chapter 6: Conclusion and Recommendations", sections: ["conclusion", "recommendations"] },
];

function textToParagraphs(text: string): DocBlock[] {
  const trimmed = text.trim();
  if (!trimmed) return [{ type: "paragraph", text: PLACEHOLDER }];
  return trimmed
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((text) => ({ type: "paragraph" as const, text }));
}

function formatAuthors(authors: string[]): string {
  if (authors.length === 0) return "Unknown author";
  if (authors.length === 1) return authors[0];
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`;
  return `${authors.slice(0, -1).join(", ")}, & ${authors[authors.length - 1]}`;
}

/** Reference list is built from the verified `research_citations` rows, never from prose — spec §19/§59: the exported bibliography must trace back to real saved sources, not whatever a model wrote into the References section's free text. */
export async function compileDocumentModel(
  supabase: SupabaseClient,
  projectId: string,
): Promise<DocumentModel> {
  const project = await getProject(supabase, projectId);
  if (!project) throw new Error("Project not found");

  const [sections, citations, instruments] = await Promise.all([
    listSections(supabase, projectId),
    listCitations(supabase, projectId),
    listInstruments(supabase, projectId),
  ]);
  const sectionMap = new Map(sections.map((s) => [s.section_type, s]));

  // The Title *section* is the thesis title as iteratively drafted and
  // alignment-checked through the research chain (spec's opening
  // requirement) — it's the authoritative title once drafted. project.title
  // is only the label chosen at project creation and can go stale once the
  // real title has been refined, so it's a fallback, not the primary source.
  const draftedTitle = sectionMap.get("title")?.content.trim();
  const documentTitle = draftedTitle || project.title;

  const blocks: DocBlock[] = [];

  blocks.push({ type: "heading", level: 1, text: documentTitle });
  const meta = [project.discipline, project.study_design, project.location].filter(Boolean).join(" · ");
  if (meta) blocks.push({ type: "paragraph", text: meta });
  blocks.push({ type: "pagebreak" });

  for (const chapter of CHAPTERS) {
    blocks.push({ type: "heading", level: 1, text: chapter.heading });
    for (const sectionType of chapter.sections) {
      blocks.push({ type: "heading", level: 2, text: SECTION_LABELS[sectionType] });
      const content = sectionMap.get(sectionType)?.content ?? "";
      blocks.push(...textToParagraphs(content));

      if (sectionType === "questionnaire" && instruments.length > 0) {
        for (const instrument of instruments) {
          blocks.push({ type: "heading", level: 3, text: `Instrument: ${instrument.name}` });
          blocks.push({
            type: "paragraph",
            text: `Validation status: ${instrument.validation_status}${
              instrument.source_reference ? ` — source: ${instrument.source_reference}` : ""
            }`,
          });
        }
      }
    }
    blocks.push({ type: "pagebreak" });
  }

  blocks.push({ type: "heading", level: 1, text: "References" });
  if (citations.length === 0) {
    blocks.push({ type: "paragraph", text: PLACEHOLDER });
  } else {
    const sorted = [...citations].sort((a, b) => a.citation_key.localeCompare(b.citation_key));
    for (const c of sorted) {
      const parts = [
        `[${c.citation_key}]`,
        `${formatAuthors(c.authors)}${c.year ? ` (${c.year})` : ""}.`,
        c.title ? `${c.title}.` : null,
        c.journal ? `${c.journal}.` : null,
        c.doi ? `https://doi.org/${c.doi}` : c.url ? c.url : null,
      ].filter(Boolean);
      blocks.push({ type: "paragraph", text: parts.join(" ") });
    }
  }
  blocks.push({ type: "pagebreak" });

  blocks.push({ type: "heading", level: 1, text: "Appendices" });
  blocks.push(...textToParagraphs(sectionMap.get("appendices")?.content ?? ""));

  for (const instrument of instruments) {
    const questions = await listQuestions(supabase, instrument.id);
    if (questions.length === 0) continue;
    blocks.push({ type: "heading", level: 2, text: `Appendix: ${instrument.name} — Full Instrument` });
    blocks.push({
      type: "table",
      headers: ["#", "Section", "Question", "Type", "Options", "Required"],
      rows: questions.map((q) => [
        String(q.order_index + 1),
        q.section_label,
        q.question_text,
        q.response_type,
        q.options?.join("; ") ?? "",
        q.required ? "Yes" : "No",
      ]),
    });
  }

  return { title: documentTitle, project, blocks };
}
