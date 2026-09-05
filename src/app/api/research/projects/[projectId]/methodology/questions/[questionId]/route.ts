import { z } from "zod";
import { entityRoute } from "@/lib/api/methodology-crud";
import {
  deleteResearchQuestion,
  listResearchQuestions,
  updateResearchQuestion,
} from "@/lib/db/methodology";

const patchSchema = z
  .object({
    questionText: z.string().trim().min(1).max(1000).optional(),
    questionKind: z
      .enum(["descriptive", "comparative", "correlational", "causal", "exploratory", "unclassified"])
      .optional(),
    orderIndex: z.number().int().min(0).max(999).optional(),
  })
  .refine((p) => Object.keys(p).length > 0, { message: "Nothing to update" });

export const { PATCH, DELETE } = entityRoute(
  {
    label: "research question",
    entityType: "research_question",
    key: "question",
    patchSchema,
    get: async (supabase, projectId, id) =>
      (await listResearchQuestions(supabase, projectId)).find((q) => q.id === id) ?? null,
    update: (supabase, projectId, id, patch) =>
      updateResearchQuestion(supabase, projectId, id, {
        ...(patch.questionText !== undefined ? { question_text: patch.questionText } : {}),
        ...(patch.questionKind !== undefined ? { question_kind: patch.questionKind } : {}),
        ...(patch.orderIndex !== undefined ? { order_index: patch.orderIndex } : {}),
      }),
    remove: deleteResearchQuestion,
    summary: (row) => `Updated research question: ${row.question_text.slice(0, 120)}`,
  },
  "questionId",
);
