import { NextResponse } from "next/server";
import { AIOrchestrator } from "@/lib/ai/orchestrator";
import { aiRequestSchema } from "@/lib/ai/request-schema";
import { requireUserId } from "@/lib/supabase/server";

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

  const orchestrator = new AIOrchestrator({ userId });
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of orchestrator.stream(parsed.data)) {
          if (chunk.delta) controller.enqueue(encoder.encode(chunk.delta));
        }
      } catch {
        controller.enqueue(encoder.encode("\n[AI response interrupted — please retry.]"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
