import { z } from "zod";
import { collectionRoute } from "@/lib/api/methodology-crud";
import { createResearchQuestion, listResearchQuestions } from "@/lib/db/methodology";

const QUESTION_KINDS = [
  "descriptive", "comparative", "correlational", "causal", "exploratory", "unclassified",
] as const;

const createSchema = z.object({
  questionText: z.string().trim().min(1).max(1000),
  questionKind: z.enum(QUESTION_KINDS).optional(),
  /**
   * Set when the researcher is accepting a suggestion, so provenance survives
   * the accept. It cannot create an unconfirmed row: a row exists because the
   * researcher decided it should.
   */
  provenance: z.enum(["user", "ai_suggested", "imported"]).optional(),
  orderIndex: z.number().int().min(0).max(999).optional(),
});

export const { GET, POST } = collectionRoute({
  label: "research questions",
  entityType: "research_question",
  key: "questions",
  list: listResearchQuestions,
  createSchema,
  create: (supabase, projectId, input) =>
    createResearchQuestion(supabase, {
      project_id: projectId,
      question_text: input.questionText,
      question_kind: input.questionKind ?? "unclassified",
      provenance: input.provenance ?? "user",
      confirmed: true,
      order_index: input.orderIndex ?? 0,
    }),
  summary: (row) => `Added research question: ${row.question_text.slice(0, 120)}`,
});
