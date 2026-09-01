"use client";

import { useState } from "react";
import { primaryActions, secondaryActions, type SectionAction, type SectionActionId } from "@/lib/ai/sections/actions";
import type { SectionType } from "@/lib/db/types";

/**
 * Phase 16 §4/§25: contextual AI actions, with progressive disclosure.
 *
 * The registry decides which actions a section offers, so this component
 * never hard-codes a list and a section can never present an action its
 * pipeline would refuse. Primary actions are visible; the rest live behind
 * "More", because a row of ten buttons is not a feature for a student writing
 * their first thesis.
 *
 * Actions that need existing content are rendered disabled with the reason
 * stated (§27), rather than hidden — a disappearing button is harder to
 * understand than one that says why it cannot run yet.
 */
export default function SectionActions({
  sectionType,
  hasContent,
  busyAction,
  disabled,
  onRun,
}: {
  sectionType: SectionType;
  hasContent: boolean;
  busyAction: SectionActionId | null;
  disabled?: boolean;
  onRun: (action: SectionAction) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const primary = primaryActions(sectionType);
  const secondary = secondaryActions(sectionType);

  function renderButton(action: SectionAction, variant: "primary" | "secondary") {
    const blockedForEmpty = action.requiresContent && !hasContent;
    const isBusy = busyAction === action.id;
    const isDisabled = Boolean(disabled) || blockedForEmpty || busyAction !== null;

    const reason = blockedForEmpty
      ? "Write or generate some content first — this action works on existing text."
      : action.description;

    return (
      <button
        key={action.id}
        type="button"
        onClick={() => onRun(action)}
        disabled={isDisabled}
        aria-disabled={isDisabled}
        aria-describedby={`action-desc-${action.id}`}
        title={reason}
        className={
          variant === "primary"
            ? "rounded bg-neutral-900 px-2.5 py-1.5 text-xs font-medium text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
            : "rounded border border-neutral-300 px-2.5 py-1.5 text-xs disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        }
      >
        {isBusy ? `${action.label}…` : action.label}
        <span id={`action-desc-${action.id}`} className="sr-only">
          {reason}
        </span>
      </button>
    );
  }

  return (
    <div className="border-b border-neutral-200 pb-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-xs font-medium text-neutral-500">AI Assist</span>
        {primary.map((a) => renderButton(a, "primary"))}
        {secondary.length > 0 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            aria-controls={`more-actions-${sectionType}`}
            className="rounded border border-neutral-300 px-2.5 py-1.5 text-xs focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
          >
            {expanded ? "Less" : "More"}
          </button>
        )}
      </div>

      {expanded && secondary.length > 0 && (
        <div id={`more-actions-${sectionType}`} className="mt-2 flex flex-wrap gap-1.5">
          {secondary.map((a) => renderButton(a, "secondary"))}
        </div>
      )}

      {busyAction && (
        <p role="status" aria-live="polite" className="mt-2 text-xs text-neutral-500">
          Working on “{busyAction.replace(/_/g, " ")}”. Nothing is saved until you review the result.
        </p>
      )}
    </div>
  );
}
