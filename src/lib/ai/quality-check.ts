import type { SupabaseClient } from "@supabase/supabase-js";
import { getProject, SECTION_CHAIN } from "../db/projects";
import { listSections } from "../db/sections";
import type { SectionType } from "../db/types";
import { SECTION_LABELS } from "../db/types";
import { verifyCitationsInText } from "./integrity-guard";
import { AIOrchestrator } from "./orchestrator";
import { QUALITY_CHECK_RESPONSE_JSON_SCHEMA, qualityCheckResponseSchema } from "./schemas";
import type { QualityScoreBreakdown, ResearchWarning } from "./types";

export interface QualityCheckResult {
  scores: QualityScoreBreakdown;
  issues: ResearchWarning[];
  /** Always show this alongside the scores — never present them as an official grade (spec §33). */
  disclaimer: string;
}

const DISCLAIMER = "AI Quality Estimate — a starting point for your own review, not an official grade.";

/**
 * The combined dashboard check (spec §32/§33): one AI call for semantic
 * scoring + alignment-style issues (reusing the same schema/prompt shape
 * as the alignment engine, just paired with scores in the same response
 * to avoid two model calls for overlapping analysis — §11 token-saving),
 * plus code-level checks an AI call shouldn't be needed for at all:
 * structural completeness and citation existence.
 */
export async function runQualityCheck(
  supabase: SupabaseClient,
  projectId: string,
  options: { userId?: string } = {},
): Promise<QualityCheckResult> {
  const project = await getProject(supabase, projectId);
  if (!project) {
    throw new Error(`runQualityCheck: project ${projectId} not found`);
  }

  const sections = await listSections(supabase, projectId);
  const structuralIssues = checkStructure(sections);

  const allContent = sections.map((s) => s.content).join("\n\n");
  const citationIssues = await verifyCitationsInText(supabase, projectId, allContent);

  const context = sections
    .filter((s) => s.content.trim())
    .map((s) => `## ${SECTION_LABELS[s.section_type]}\n${s.content}`)
    .join("\n\n");

  if (!context) {
    return {
      scores: zeroScores(),
      issues: [
        {
          severity: "informational",
          category: "structure",
          message: "No sections have content yet — nothing to score.",
        },
        ...structuralIssues,
      ],
      disclaimer: DISCLAIMER,
    };
  }

  const orchestrator = new AIOrchestrator({ userId: options.userId, supabase });
  const response = await orchestrator.generate({
    projectId,
    taskType: "quality_check",
    message:
      "Score this research project's quality (methodology, evidence, alignment, writing, references, data integrity, overall — each 0-100) and list specific issues.",
    context,
    responseSchema: QUALITY_CHECK_RESPONSE_JSON_SCHEMA,
  });

  const { scores, issues: aiIssues } = parseQualityResponse(response.content);

  return {
    scores,
    issues: [...structuralIssues, ...citationIssues, ...aiIssues].map((issue) => ({
      ...issue,
      section: issue.section || undefined,
      recommendation: issue.recommendation || undefined,
    })),
    disclaimer: DISCLAIMER,
  };
}

/** Purely structural — no AI call needed, this is just "did the researcher fill anything in yet." */
function checkStructure(
  sections: { section_type: SectionType; status: string }[],
): ResearchWarning[] {
  const byType = new Map(sections.map((s) => [s.section_type, s.status]));
  const notStarted = SECTION_CHAIN.filter((s) => (byType.get(s) ?? "not_started") === "not_started");

  if (notStarted.length === 0) return [];
  if (notStarted.length === SECTION_CHAIN.length) return [];

  return [
    {
      severity: "informational",
      category: "structure",
      message: `${notStarted.length} of ${SECTION_CHAIN.length} sections haven't been started yet: ${notStarted
        .map((s) => SECTION_LABELS[s])
        .join(", ")}.`,
    },
  ];
}

function zeroScores(): QualityScoreBreakdown {
  return { methodology: 0, evidence: 0, alignment: 0, writing: 0, references: 0, dataIntegrity: 0, overall: 0 };
}

function parseQualityResponse(content: string): { scores: QualityScoreBreakdown; issues: ResearchWarning[] } {
  try {
    const parsed = qualityCheckResponseSchema.parse(JSON.parse(content));
    return { scores: parsed.scores, issues: parsed.issues };
  } catch {
    return {
      scores: zeroScores(),
      issues: [
        {
          severity: "low",
          category: "system",
          message: "The automated quality scorer did not return a valid response. Scores shown are placeholders — review manually.",
        },
      ],
    };
  }
}
