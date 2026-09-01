"use client";

import { useEffect, useRef, useState } from "react";
import AIChangeControl, { type ChangeAction } from "@/components/AIChangeControl";
import SectionActions from "@/components/SectionActions";
import type { SectionAction, SectionActionId } from "@/lib/ai/sections/actions";
import { SECTION_LABELS } from "@/lib/db/types";
import type { ResearchSectionRow, SectionStatus, SectionType } from "@/lib/db/types";

interface PendingSuggestion {
  text: string;
  actionId: SectionActionId;
  provider?: string;
  model?: string;
  warnings?: { severity: string; category: string; message: string }[];
  contextLayers?: string[];
}

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
  // Coarse, session-level provenance (Phase 15 §4's trust taxonomy) — "AI
  // helped write this section at some point," not sentence-level
  // attribution. Once a user edits around an AI insert there's no honest
  // way to say which words are whose, so this deliberately doesn't try;
  // it answers "was AI ever used here," which is the useful, defensible
  // claim.
  const [metadata, setMetadata] = useState<Record<string, unknown>>(initialSection?.metadata ?? {});
  const [saveState, setSaveState] = useState<SaveState>("idle");
  // AI output waits here until the researcher decides what to do with it.
  // Nothing reaches `content` without an explicit choice (§17).
  const [pending, setPending] = useState<PendingSuggestion | null>(null);
  const [busyAction, setBusyAction] = useState<SectionActionId | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
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
  /** Set when the next save originates from an accepted AI change (§18). */
  const pendingChangeRef = useRef<{
    action: ChangeAction;
    provider?: string;
    model?: string;
    sectionAction?: string;
  } | null>(null);

  // Copilot output now goes through the same review step as a section
  // action, rather than appending straight into the section.
  useEffect(() => {
    if (!insertRequest) return;
    setPending({ text: insertRequest, actionId: "generate" });
    onInsertConsumed?.();
    // insertRequest is intentionally the only dependency: onInsertConsumed
    // is a fresh function each render and would cause this to loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [insertRequest]);

  async function runAction(action: SectionAction) {
    setBusyAction(action.id);
    setActionError(null);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/sections/${sectionType}/ai`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actionId: action.id }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The route already translated any provider error into something a
        // researcher can act on, and says whether anything was saved (§28).
        throw new Error(body.error ?? "The AI action could not be completed.");
      }
      setPending({
        text: body.content,
        actionId: action.id,
        provider: body.provider,
        model: body.model,
        warnings: body.warnings,
        contextLayers: body.contextLayers,
      });
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      setBusyAction(null);
    }
  }

  function applySuggestion(changeAction: ChangeAction, text: string) {
    const next =
      changeAction === "replace" ? text : content.trim() ? `${content}\n\n${text}` : text;

    setContent(next);
    setMetadata((prev) => ({ ...prev, aiAssisted: true, lastAiInsertAt: new Date().toISOString() }));
    // Provenance travels with the save so the version row records which
    // action and model produced the change, not just that content moved.
    pendingChangeRef.current = {
      action: changeAction,
      provider: pending?.provider,
      model: pending?.model,
      sectionAction: pending?.actionId,
    };
    setPending(null);
  }

  async function save(nextContent: string, nextStatus: SectionStatus, nextMetadata: Record<string, unknown>) {
    setSaveState("saving");
    try {
      const res = await fetch(`/api/research/projects/${projectId}/sections/${sectionType}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: nextContent,
          status: nextStatus,
          metadata: nextMetadata,
          change: pendingChangeRef.current ?? { action: "manual" },
        }),
      });
      if (!res.ok) throw new Error("save failed");
      const { section } = await res.json();
      pendingChangeRef.current = null;
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
    debounceRef.current = setTimeout(() => save(content, status, metadata), 800);
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

      <SectionActions
        sectionType={sectionType}
        hasContent={content.trim().length > 0}
        busyAction={busyAction}
        onRun={runAction}
      />

      {actionError && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
          {actionError} Your section content was not changed.
        </p>
      )}

      {pending && (
        <AIChangeControl
          proposed={pending.text}
          currentContent={content}
          warnings={pending.warnings}
          contextLayers={pending.contextLayers}
          onApply={applySuggestion}
          onCancel={() => setPending(null)}
        />
      )}

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
