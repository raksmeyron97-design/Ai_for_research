"use client";

import { useMemo, useState } from "react";
import { diffWords } from "@/lib/text/diff-words";

export type ChangeAction = "insert" | "replace" | "append";

/**
 * Phase 16 §17: AI-generated content never reaches the section without an
 * explicit decision. The researcher chooses how it lands — and for a
 * replacement, sees exactly what would be lost first.
 *
 * Cancel is a real, always-available option, and closing without choosing is
 * a cancel. There is no default action and nothing is pre-selected: a dialog
 * that applies something when dismissed is how content gets silently
 * overwritten.
 */
export default function AIChangeControl({
  proposed,
  currentContent,
  warnings,
  contextLayers,
  onApply,
  onCancel,
}: {
  proposed: string;
  currentContent: string;
  warnings?: { severity: string; category: string; message: string }[];
  contextLayers?: string[];
  onApply: (action: ChangeAction, text: string) => void;
  onCancel: () => void;
}) {
  const [showDiff, setShowDiff] = useState(false);
  const [copied, setCopied] = useState(false);

  const diff = useMemo(
    () => (showDiff ? diffWords(currentContent, proposed) : null),
    [showDiff, currentContent, proposed],
  );

  const hasContent = currentContent.trim().length > 0;

  async function copy() {
    try {
      await navigator.clipboard.writeText(proposed);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section
      aria-label="Review AI suggestion"
      className="rounded border border-blue-300 bg-blue-50/60 p-3"
    >
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-blue-900">AI suggestion — nothing is saved yet</h3>
        {contextLayers && contextLayers.length > 0 && (
          <p className="text-xs text-blue-800" title="What the assistant was shown">
            Based on: {contextLayers.join(", ")}
          </p>
        )}
      </div>

      {warnings && warnings.length > 0 && (
        <ul className="mb-2 space-y-1" aria-label="Warnings about this suggestion">
          {warnings.map((w, i) => (
            <li key={i} className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs text-amber-900">
              <span className="font-medium">{w.category}:</span> {w.message}
            </li>
          ))}
        </ul>
      )}

      <div className="mb-3 max-h-64 overflow-y-auto whitespace-pre-wrap rounded border border-blue-200 bg-white p-2 text-sm">
        {showDiff && diff ? (
          <p>
            {diff.map((part, i) => (
              <span
                key={i}
                className={
                  part.type === "added"
                    ? "bg-green-100 text-green-900"
                    : part.type === "removed"
                      ? "bg-red-100 text-red-900 line-through"
                      : ""
                }
              >
                {part.text}
              </span>
            ))}
          </p>
        ) : (
          proposed
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {hasContent && (
          <button
            type="button"
            onClick={() => onApply("append", proposed)}
            className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
          >
            Append
          </button>
        )}
        <button
          type="button"
          onClick={() => onApply("insert", proposed)}
          className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          {hasContent ? "Insert at end" : "Insert"}
        </button>
        {hasContent && (
          <>
            <button
              type="button"
              onClick={() => setShowDiff((v) => !v)}
              aria-pressed={showDiff}
              className="rounded border border-neutral-300 px-3 py-1.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
            >
              {showDiff ? "Hide changes" : "Show changes"}
            </button>
            <button
              type="button"
              onClick={() => onApply("replace", proposed)}
              // Replace is the only destructive option, so it is styled as
              // one and sits behind the diff rather than beside Insert.
              className="rounded border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-600 focus-visible:ring-offset-2"
            >
              Replace all
            </button>
          </>
        )}
        <button
          type="button"
          onClick={copy}
          className="rounded border border-neutral-300 px-3 py-1.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          {copied ? "Copied" : "Copy"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto rounded px-3 py-1.5 text-xs text-neutral-600 hover:text-neutral-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Discard
        </button>
      </div>
    </section>
  );
}
