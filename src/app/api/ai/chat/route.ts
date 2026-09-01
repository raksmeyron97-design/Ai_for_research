import { NextResponse } from "next/server";
import { createConversation, getConversation, insertMessage } from "@/lib/db";
import { getProject } from "@/lib/db/projects";
import { requiresDataset } from "@/lib/ai/integrity-guard";
import { AIOrchestrator } from "@/lib/ai/orchestrator";
import { resolveRequestContext } from "@/lib/ai/prepare-request";
import { aiRequestSchema } from "@/lib/ai/request-schema";
import type { AIRequest } from "@/lib/ai/types";
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

  // Explicit ownership check: RLS would already stop a cross-project read/
  // write, but checking here turns "your data is silently invisible" into
  // a clean 404 instead of a confusing empty AIRequest.context.
  const project = await getProject(supabase, parsed.data.projectId);
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

  const orchestrator = new AIOrchestrator({ userId });
  const encoder = new TextEncoder();
  let assistantContent = "";

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of orchestrator.stream(requestWithContext)) {
          if (chunk.delta) {
            assistantContent += chunk.delta;
            controller.enqueue(encoder.encode(chunk.delta));
          }
        }
      } catch {
        controller.enqueue(encoder.encode("\n[AI response interrupted — please retry.]"));
      } finally {
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
