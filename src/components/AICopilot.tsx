"use client";

import { useRef, useState } from "react";
import { SECTION_LABELS } from "@/lib/db/types";
import type { SectionType } from "@/lib/db/types";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export default function AICopilot({
  projectId,
  sectionType,
  onInsert,
}: {
  projectId: string;
  sectionType: SectionType;
  onInsert: (text: string) => void;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationIdRef = useRef<string | null>(null);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const message = input.trim();
    if (!message || sending) return;

    setError(null);
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: message }]);
    setSending(true);

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId,
          taskType: "chat",
          message,
          sectionId: sectionType,
          conversationId: conversationIdRef.current ?? undefined,
        }),
      });

      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "AI request failed");
      }

      const returnedConversationId = res.headers.get("X-Conversation-Id");
      if (returnedConversationId) conversationIdRef.current = returnedConversationId;

      setMessages((prev) => [...prev, { role: "assistant", content: "" }]);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const delta = decoder.decode(value, { stream: true });
        setMessages((prev) => {
          const next = [...prev];
          next[next.length - 1] = { role: "assistant", content: next[next.length - 1].content + delta };
          return next;
        });
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-200 p-3">
        <h2 className="text-sm font-medium">AI Copilot</h2>
        <p className="text-xs text-neutral-500">Grounded in {SECTION_LABELS[sectionType]} and your project profile.</p>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && (
          <p className="text-xs text-neutral-400">
            Ask for a draft, a critique, or a check — the assistant recommends, you decide what to keep.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div
              className={`inline-block max-w-[90%] whitespace-pre-wrap rounded px-3 py-2 text-left text-sm ${
                m.role === "user" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-900"
              }`}
            >
              {m.content || (sending && i === messages.length - 1 ? "…" : "")}
            </div>
            {m.role === "assistant" && m.content && (
              <div className="mt-1">
                <button
                  type="button"
                  onClick={() => onInsert(m.content)}
                  className="text-xs text-neutral-500 underline hover:text-neutral-800"
                >
                  Insert into {SECTION_LABELS[sectionType]}
                </button>
              </div>
            )}
          </div>
        ))}
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      <form onSubmit={handleSend} className="flex gap-2 border-t border-neutral-200 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the AI Copilot…"
          className="flex-1 rounded border border-neutral-300 px-3 py-2 text-sm"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded bg-neutral-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
