import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeProject, dbErrorResponse } from "@/lib/api/authorize";
import {
  getConstruct,
  listConstructs,
  listIndicators,
  listResearchQuestions,
} from "@/lib/db/methodology";
import { getQuestion, listQuestionsForProject } from "@/lib/db/questions";
import { CONSTRUCT_ROLE_LABELS } from "@/lib/db/types";
import {
  MethodologySuggestionError,
  suggestConstructs,
  suggestHypotheses,
  suggestItemMapping,
  suggestItemRewrite,
  suggestItems,
  suggestOperationalDefinition,
} from "@/lib/methodology/suggestions";

/**
 * Every methodology AI proposal, behind one rate-limited route (§16, §27).
 *
 * One route rather than six near-identical ones, because the part that must not
 * drift is the preamble: authenticate, resolve the project, check ownership,
 * apply the AI rate limit, and — the part specific to this route — **build the
 * candidate lists from the database, never from the request.**
 *
 * That last rule is what makes a cross-project id impossible rather than merely
 * detected. The client says which item or construct it is working on; it never
 * says what the model may choose among. The candidate ids come from
 * project-scoped queries, and the suggestion layer then discards anything not
 * in that list. A caller cannot offer the model an id from another project
 * because a caller cannot offer the model anything.
 *
 * Nothing here writes. Every response is a proposal the researcher then accepts
 * through the ordinary CRUD routes, which is where the audit entry is written.
 */
const requestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("item_mapping"), itemId: z.string().uuid() }),
  z.object({ kind: z.literal("constructs"), questionId: z.string().uuid() }),
  z.object({ kind: z.literal("hypotheses"), questionId: z.string().uuid() }),
  z.object({
    kind: z.literal("items"),
    constructId: z.string().uuid(),
    indicatorId: z.string().uuid().nullable().optional(),
  }),
  z.object({ kind: z.literal("item_rewrite"), itemId: z.string().uuid(), concerns: z.array(z.string().max(300)).max(10).optional() }),
  z.object({ kind: z.literal("operational_definition"), constructId: z.string().uuid() }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const body = await req.json().catch(() => null);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const auth = await authorizeProject(projectId, { rateLimit: "ai" });
  if (!auth.ok) return auth.response;

  const { supabase, userId } = auth.auth;
  const request = parsed.data;

  try {
    switch (request.kind) {
      case "item_mapping": {
        const item = await getQuestion(supabase, projectId, request.itemId);
        if (!item) return NextResponse.json({ error: "That item was not found." }, { status: 404 });

        const [constructs, indicators] = await Promise.all([
          listConstructs(supabase, projectId),
          listIndicators(supabase, projectId),
        ]);
        const constructNames = new Map(constructs.map((c) => [c.id, c.name]));

        return NextResponse.json(
          await suggestItemMapping(supabase, {
            projectId,
            itemText: item.question_text,
            userId,
            constructs: constructs.map((c) => ({
              id: c.id,
              label: c.name,
              detail: CONSTRUCT_ROLE_LABELS[c.role],
            })),
            indicators: indicators.map((i) => ({
              id: i.id,
              label: i.name,
              detail: constructNames.get(i.construct_id),
            })),
          }),
        );
      }

      case "constructs": {
        const question = (await listResearchQuestions(supabase, projectId)).find((q) => q.id === request.questionId);
        if (!question) return NextResponse.json({ error: "That question was not found." }, { status: 404 });

        const constructs = await listConstructs(supabase, projectId);
        return NextResponse.json(
          await suggestConstructs(supabase, {
            projectId,
            userId,
            questionText: question.question_text,
            existingNames: constructs.map((c) => c.name),
          }),
        );
      }

      case "hypotheses": {
        const question = (await listResearchQuestions(supabase, projectId)).find((q) => q.id === request.questionId);
        if (!question) return NextResponse.json({ error: "That question was not found." }, { status: 404 });

        const constructs = await listConstructs(supabase, projectId);
        return NextResponse.json(
          await suggestHypotheses(supabase, {
            projectId,
            userId,
            questionText: question.question_text,
            constructs: constructs.map((c) => ({
              id: c.id,
              label: c.name,
              detail: CONSTRUCT_ROLE_LABELS[c.role],
            })),
          }),
        );
      }

      case "items": {
        const construct = await getConstruct(supabase, projectId, request.constructId);
        if (!construct) return NextResponse.json({ error: "That construct was not found." }, { status: 404 });

        const indicators = await listIndicators(supabase, projectId);
        const indicator = request.indicatorId
          ? indicators.find((i) => i.id === request.indicatorId && i.construct_id === construct.id)
          : undefined;
        if (request.indicatorId && !indicator) {
          return NextResponse.json(
            { error: "That indicator was not found under this construct." },
            { status: 404 },
          );
        }

        // Only the items already measuring this construct — enough for the
        // model to avoid repeating one, without sending the questionnaire.
        const existingItems = (await listQuestionsForProject(supabase, projectId))
          .filter((i) => i.construct_id === construct.id)
          .map((i) => i.question_text);

        return NextResponse.json(
          await suggestItems(supabase, {
            projectId,
            userId,
            constructName: construct.name,
            constructId: construct.id,
            indicatorName: indicator?.name,
            indicatorId: indicator?.id ?? null,
            operationalDefinition: construct.operational_definition,
            existingItems,
          }),
        );
      }

      case "item_rewrite": {
        const item = await getQuestion(supabase, projectId, request.itemId);
        if (!item) return NextResponse.json({ error: "That item was not found." }, { status: 404 });

        return NextResponse.json(
          await suggestItemRewrite(supabase, {
            projectId,
            userId,
            itemText: item.question_text,
            concerns: request.concerns,
          }),
        );
      }

      case "operational_definition": {
        const construct = await getConstruct(supabase, projectId, request.constructId);
        if (!construct) return NextResponse.json({ error: "That construct was not found." }, { status: 404 });

        const indicators = await listIndicators(supabase, projectId);
        return NextResponse.json(
          await suggestOperationalDefinition(supabase, {
            projectId,
            userId,
            constructName: construct.name,
            conceptualDefinition: construct.conceptual_definition,
            indicatorNames: indicators.filter((i) => i.construct_id === construct.id).map((i) => i.name),
          }),
        );
      }
    }
  } catch (err) {
    if (err instanceof MethodologySuggestionError) {
      return NextResponse.json({ error: err.userMessage }, { status: 502 });
    }
    return dbErrorResponse("That suggestion");
  }
}
