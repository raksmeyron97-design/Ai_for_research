"use client";

import { useEffect, useRef, useState } from "react";
import { SECTION_LABELS } from "@/lib/db/types";
import type { ResearchSectionRow, SectionStatus, SectionType } from "@/lib/db/types";

type SaveState = "idle" | "saving" | "saved" | "error";

/**
 * Remounted (via `key={sectionType}` from the parent) on every section
 * switch, so its local state always starts fresh from that section's
 * saved content rather than needing prop-sync effects.
 */
export default function SectionEditor({
  projectId,
  sectionType,
  initialSection,
  onSaved,
  insertRequest,
  onInsertConsumed,
}: {
  projectId: string;
  sectionType: SectionType;
  initialSection: ResearchSectionRow | undefined;
  onSaved: (section: ResearchSectionRow) => void;
  /** Text queued by the AI Copilot's "Insert" button — consumed once, then cleared by the parent. */
  insertRequest?: string | null;
  onInsertConsumed?: () => void;
}) {
  const [content, setContent] = useState(initialSection?.content ?? "");
  const [status, setStatus] = useState<SectionStatus>(initialSection?.status ?? "not_started");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // Baseline to diff against, not an "is this the first effect run" flag —
  // a boolean ref for that purpose breaks under React Strict Mode's dev-only
  // double-invocation of effects (confirmed against a real Postgres
  // instance: the first invocation flips the flag, so the second
  // invocation — still logically the same initial mount — reads it as
  // false and fires an unnecessary save). Comparing against the loaded
  // values is correct regardless of how many times the effect runs.
  const initialContentRef = useRef(initialSection?.content ?? "");
  const initialStatusRef = useRef(initialSection?.status ?? "not_started");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!insertRequest) return;
    setContent((prev) => (prev ? `${prev}\n\n${insertRequest}` : insertRequest));
    onInsertConsumed?.();
    // insertRequest is intentionally the only dependency: onInsertConsumed
    // is a fresh function each render and would cause this to loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertRequest]);

  async function save(nextContent: string, nextStatus: SectionStatus) {
    setSaveState("saving");
    try {
      const res = await fetch(`/api/research/projects/${projectId}/sections/${sectionType}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: nextContent, status: nextStatus }),
      });
      if (!res.ok) throw new Error("save failed");
      const { section } = await res.json();
      setSaveState("saved");
      onSaved(section);
    } catch {
      setSaveState("error");
    }
  }

  useEffect(() => {
    if (content === initialContentRef.current && status === initialStatusRef.current) {
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => save(content, status), 800);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [content, status]);

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">{SECTION_LABELS[sectionType]}</h2>
        <div className="flex items-center gap-2">
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as SectionStatus)}
            className="rounded border border-neutral-300 px-2 py-1 text-xs"
          >
            <option value="not_started">Not started</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
          </select>
          <span className="w-14 text-xs text-neutral-400">
            {saveState === "saving" && "Saving…"}
            {saveState === "saved" && "Saved"}
            {saveState === "error" && <span className="text-red-500">Error</span>}
          </span>
        </div>
      </div>

      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={`Write ${SECTION_LABELS[sectionType].toLowerCase()} here, or ask the AI Copilot for a draft.`}
        className="min-h-0 flex-1 resize-none rounded border border-neutral-200 p-3 text-sm leading-relaxed focus:border-neutral-400 focus:outline-none"
        id={`section-editor-${sectionType}`}
      />
    </div>
  );
}
