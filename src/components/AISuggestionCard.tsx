"use client";

import { useState, type ReactNode } from "react";

/**
 * One AI proposal, with the three things a researcher can do with it (§16).
 *
 * Generate → show rationale → accept, edit or reject → persist the decision.
 * Editing is not a separate mode: the editable text is the proposal, and
 * accepting an edited proposal records both what was offered and what was
 * kept, which is the distinction §23 asks the history to preserve.
 *
 * Rejecting calls back too. A rejection creates no row, so without telling
 * anyone the history would show only accepted suggestions — and "five were
 * proposed, I kept one" would look exactly like "one was proposed".
 */
export default function AISuggestionCard({
  title,
  rationale,
  editableText,
  onEditableTextChange,
  meta,
  busy,
  onAccept,
  onReject,
  acceptLabel = "Accept",
  disabledReason,
}: {
  title: string;
  /** Why the model proposed this. Shown before the accept button, not after. */
  rationale?: string;
  /** Present when the proposal is text the researcher may edit before accepting. */
  editableText?: string;
  onEditableTextChange?: (text: string) => void;
  /** Extra detail rows — a mapped construct, a response type, a confidence. */
  meta?: ReactNode;
  busy?: boolean;
  onAccept: () => void;
  onReject: () => void;
  acceptLabel?: string;
  /** Set when the proposal cannot be accepted as it stands, with the reason. */
  disabledReason?: string;
}) {
  const [showRationale, setShowRationale] = useState(false);

  return (
    <li className="rounded border border-violet-200 bg-violet-50/50 p-2.5 text-xs">
      <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-900">
          AI SUGGESTED
        </span>
        <span className="font-medium text-neutral-800">{title}</span>
      </div>

      {editableText !== undefined && onEditableTextChange ? (
        <>
          <label htmlFor={`suggestion-${title}`} className="sr-only">
            Edit this suggestion before accepting it
          </label>
          <textarea
            id={`suggestion-${title}`}
            value={editableText}
            onChange={(e) => onEditableTextChange(e.target.value)}
            rows={2}
            className="w-full resize-y rounded border border-neutral-300 p-1.5 text-xs focus:border-neutral-500 focus:outline-none"
          />
        </>
      ) : null}

      {meta && <div className="mt-1.5 text-[11px] text-neutral-600">{meta}</div>}

      {rationale && (
        <>
          <button
            type="button"
            onClick={() => setShowRationale((v) => !v)}
            aria-expanded={showRationale}
            className="mt-1.5 text-[11px] text-neutral-600 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
          >
            {showRationale ? "Hide reasoning" : "Why this?"}
          </button>
          {showRationale && <p className="mt-1 text-[11px] leading-snug text-neutral-600">{rationale}</p>}
        </>
      )}

      {disabledReason && (
        <p className="mt-1.5 text-[11px] text-amber-800">{disabledReason}</p>
      )}

      <div className="mt-2 flex gap-1.5">
        <button
          type="button"
          onClick={onAccept}
          disabled={busy || Boolean(disabledReason)}
          className="rounded bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          {busy ? "Saving…" : acceptLabel}
        </button>
        <button
          type="button"
          onClick={onReject}
          disabled={busy}
          className="rounded border border-neutral-300 px-2.5 py-1 text-[11px] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Reject
        </button>
      </div>
    </li>
  );
}
