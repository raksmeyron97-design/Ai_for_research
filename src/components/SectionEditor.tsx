"use client";

import { useEffect, useRef, useState } from "react";
import {
  locateClaimInSection,
  type ClaimLocation,
  type HighlightableClaim,
} from "@/lib/integrity/claim-location";
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
  externalUpdate,
  onFindEvidence,
  highlightClaim,
  onHighlightResolved,
}: {
  projectId: string;
  sectionType: SectionType;
  initialSection: ResearchSectionRow | undefined;
  onSaved: (section: ResearchSectionRow) => void;
  /** Text queued by the AI Copilot's "Insert" button — consumed once, then cleared by the parent. */
  insertRequest?: string | null;
  onInsertConsumed?: () => void;
  /**
   * Content the server already saved — an evidence insertion or a restore.
   * Applied without re-saving: the autosave baseline moves with it, because
   * echoing a change the server just made back to the server would record a
   * second, spurious version of the same edit.
   */
  externalUpdate?: { content: string; nonce: number } | null;
  /** Sends the selected paragraph to the Evidence pane (§27). */
  onFindEvidence?: (passage: string, offset: number) => void;
  /**
   * A claim to find and select in this section (§13). `nonce` is what makes
   * asking twice for the same claim work — the researcher can click a finding
   * again after scrolling away, and without it the effect would not re-run.
   */
  highlightClaim?: { claim: HighlightableClaim; nonce: number } | null;
  /** Reports where the highlight ended up, including when it could not be
   *  placed — `claim_not_located` is a state the caller has to show, not an
   *  error to swallow (§13). */
  onHighlightResolved?: (location: ClaimLocation) => void;
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
  /** The researcher's current selection in the textarea, for Find evidence. */
  const [selection, setSelection] = useState<{ text: string; start: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
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

  // Content the server changed underneath us. The baseline refs move with it
  // so the autosave effect sees "nothing to save" rather than writing the same
  // text back and creating a duplicate version entry.
  useEffect(() => {
    if (!externalUpdate) return;
    setContent(externalUpdate.content);
    initialContentRef.current = externalUpdate.content;
    setSaveState("saved");
    setSelection(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalUpdate?.nonce]);

  // Finding -> claim -> section -> the sentence itself (§13).
  //
  // Runs against `content` — the text on screen right now, not the snapshot
  // the claim was extracted from. Asking "is this sentence still here" of a
  // stale copy would always answer yes, which is how a researcher ends up
  // staring at a highlight over the wrong words.
  useEffect(() => {
    if (!highlightClaim) return;

    const location = locateClaimInSection(content, highlightClaim.claim);
    onHighlightResolved?.(location);

    if (location.outcome !== "located" || location.start == null || location.end == null) return;

    const el = textareaRef.current;
    if (!el) return;

    // focus() before setSelectionRange(): a selection in an unfocused
    // textarea is invisible in every browser, so the researcher would be told
    // the sentence was found and shown nothing.
    el.focus();
    el.setSelectionRange(location.start, location.end);

    // Scroll the selection into view. A textarea will not do this on its own
    // for a programmatic selection, so the line is measured from the text
    // before it and the scrollTop set directly.
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const linesBefore = content.slice(0, location.start).split("\n").length - 1;
    el.scrollTop = Math.max(0, linesBefore * lineHeight - el.clientHeight / 2);

    setSelection({ text: content.slice(location.start, location.end), start: location.start });
    // `content` is deliberately not a dependency: re-running on every
    // keystroke would fight the researcher for their cursor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightClaim?.nonce]);

  function captureSelection(el: HTMLTextAreaElement) {
    const text = el.value.slice(el.selectionStart, el.selectionEnd).trim();
    // A stray click is a zero-width selection, and a couple of words is not a
    // paragraph worth extracting claims from.
    setSelection(text.length >= 20 ? { text, start: el.selectionStart } : null);
  }

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

      {onFindEvidence && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={!selection}
            onClick={() => selection && onFindEvidence(selection.text, selection.start)}
            className="rounded border border-neutral-300 px-2.5 py-1.5 text-xs disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
          >
            Find evidence for selection
          </button>
          <span className="text-[11px] text-neutral-500">
            {selection
              ? `${selection.text.split(/\s+/).length} words selected`
              : "Select a paragraph to pull out its claims."}
          </span>
        </div>
      )}

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
        ref={textareaRef}
        value={content}
        onChange={(e) => setContent(e.target.value)}
        onSelect={(e) => captureSelection(e.currentTarget)}
        onBlur={(e) => captureSelection(e.currentTarget)}
        placeholder={`Write ${SECTION_LABELS[sectionType].toLowerCase()} here, or ask the AI Copilot for a draft.`}
        className="min-h-0 flex-1 resize-none rounded border border-neutral-200 p-3 text-sm leading-relaxed focus:border-neutral-400 focus:outline-none"
        id={`section-editor-${sectionType}`}
      />
    </div>
  );
}
