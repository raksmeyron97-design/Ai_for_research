import { NextResponse } from "next/server";
import { createConversation, getConversation, insertMessage } from "@/lib/db";
import { getProject } from "@/lib/db/projects";
import { requiresDataset, verifyCitationsInText } from "@/lib/ai/integrity-guard";
import { AIOrchestrator } from "@/lib/ai/orchestrator";
import { resolveRequestContext } from "@/lib/ai/prepare-request";
import { detectPromptInjection } from "@/lib/ai/prompt-injection-guard";
import { aiRequestSchema } from "@/lib/ai/request-schema";
import { isStreamTimeout } from "@/lib/ai/stream-guard";
import type { AIRequest } from "@/lib/ai/types";
import { checkRateLimit, RATE_LIMITS, rateLimitResponseBody } from "@/lib/security/rate-limit";
import { createClient, requireUserId } from "@/lib/supabase/server";

export async function POST(req: Request) {
  let userId: string | null;
  try {
    userId = await requireUserId();
  } catch {
    return NextResponse.json({ error: "Authentication service unavailable" }, { status: 503 });
  }
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = aiRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", details: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();

  const rateLimit = await checkRateLimit(supabase, userId, RATE_LIMITS.aiRequest);
  if (!rateLimit.allowed) {
    return NextResponse.json(rateLimitResponseBody(rateLimit), { status: 429 });
  }

  // Explicit ownership check: RLS would already stop a cross-project read/
  // write, but checking here turns "your data is silently invisible" into
  // a clean 404 instead of a confusing empty AIRequest.context.
  let project;
  try {
    project = await getProject(supabase, parsed.data.projectId);
  } catch {
    return NextResponse.json({ error: "Database temporarily unavailable" }, { status: 503 });
  }
  if (!project) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  let conversation = parsed.data.conversationId
    ? await getConversation(supabase, parsed.data.conversationId)
    : null;
  if (!conversation) {
    conversation = await createConversation(supabase, { project_id: project.id, user_id: userId });
  }

  // Same reasoning as /api/ai/generate: skip context assembly (a real,
  // billable embedding call) for a request the dataset guard is about to
  // block anyway.
  const skipContext = requiresDataset(parsed.data.taskType) && !parsed.data.dataSetId;
  let requestWithContext: AIRequest;
  try {
    requestWithContext = skipContext
      ? parsed.data
      : await resolveRequestContext(supabase, { ...parsed.data, conversationId: conversation.id });
  } catch {
    return NextResponse.json({ error: "AI request failed" }, { status: 500 });
  }

  if (parsed.data.message) {
    await insertMessage(supabase, {
      conversation_id: conversation.id,
      role: "user",
      content: parsed.data.message,
      task_type: parsed.data.taskType,
    });
  }

  const orchestrator = new AIOrchestrator({ userId, supabase });
  const encoder = new TextEncoder();
  let assistantContent = "";

  // stream() has no channel for structured warnings the way generate()
  // does (AIChunk is just a text delta) — a suspicious pattern in the
  // retrieved context is surfaced as a visible note ahead of the actual
  // answer instead. See prompt-injection-guard.ts: this never blocks the
  // response, it's a heads-up for the researcher to double-check the
  // source document.
  const injectionWarning = requestWithContext.context
    ? detectPromptInjection(requestWithContext.context)
    : null;

  const stream = new ReadableStream({
    async start(controller) {
      if (injectionWarning) {
        controller.enqueue(encoder.encode(`[Note: ${injectionWarning.message}]\n\n`));
      }
      try {
        for await (const chunk of orchestrator.stream(requestWithContext)) {
          if (chunk.delta) {
            assistantContent += chunk.delta;
            controller.enqueue(encoder.encode(chunk.delta));
          }
        }
      } catch (err) {
        // A stalled stream and a provider error are different failures and
        // deserve different advice: one is worth retrying immediately, the
        // other usually is not.
        controller.enqueue(
          encoder.encode(
            isStreamTimeout(err)
              ? "\n[The model stopped responding partway through. Nothing further was received — please retry.]"
              : "\n[AI response interrupted — please retry.]",
          ),
        );
      } finally {
        // Phase 16 finding F3: this route returned model output with no
        // citation check at all, while quality-check and the discussion
        // generator both ran one. It is the highest-traffic AI surface, so
        // an invented citation key was most likely to reach a thesis from
        // here.
        //
        // Verification runs after the stream because a citation key can
        // only be checked once the sentence containing it is complete, and
        // AIChunk carries no channel for structured warnings. The note is
        // appended to the same text stream, the way the injection warning
        // is prepended — visible to the researcher without blocking or
        // rewriting the answer they already read.
        if (assistantContent) {
          try {
            const citationWarnings = await verifyCitationsInText(supabase, project.id, assistantContent);
            if (citationWarnings.length > 0) {
              controller.enqueue(
                encoder.encode(
                  `\n\n[Citation check: ${citationWarnings.map((w) => w.message).join(" ")}]`,
                ),
              );
            }
          } catch {
            // Verification is best-effort: never turn a delivered answer
            // into a failure because the check itself could not run.
          }
        }
        controller.close();
        if (assistantContent) {
          await insertMessage(supabase, {
            conversation_id: conversation.id,
            role: "assistant",
            content: assistantContent,
            task_type: parsed.data.taskType,
          }).catch(() => {
            // Best-effort: losing the persisted transcript shouldn't
            // surface as a failure to a caller who already received the
            // streamed answer.
          });
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Conversation-Id": conversation.id,
    },
  });
}
