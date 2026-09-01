"use client";

import { useState, type ReactNode } from "react";

/**
 * Phase 17 §24, closing Phase 16 gap #4.
 *
 * Desktop keeps the three-pane grid exactly as it was — §24 is explicit that
 * the existing desktop workflow must not break, and a researcher working on a
 * laptop should see no change at all.
 *
 * Below `lg` the same three children become tabs. Tabs rather than a
 * drawer-over-drawer because the panes are peers, not a hierarchy: on a phone
 * a researcher is either navigating, writing, or asking — never usefully doing
 * two at once in 375px. Crucially all three stay mounted, so switching tabs
 * does not discard editor state or an in-flight AI suggestion; they are
 * hidden with `hidden`, not unmounted.
 */
export type PaneId = "navigator" | "editor" | "assistant";

const TABS: { id: PaneId; label: string }[] = [
  { id: "navigator", label: "Sections" },
  { id: "editor", label: "Editor" },
  { id: "assistant", label: "AI Assist" },
];

export default function WorkspacePanes({
  navigator,
  editor,
  assistant,
}: {
  navigator: ReactNode;
  editor: ReactNode;
  assistant: ReactNode;
}) {
  const [active, setActive] = useState<PaneId>("editor");

  const panes: Record<PaneId, ReactNode> = { navigator, editor, assistant };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/*
        One DOM tree, not two. Rendering a mobile layout and a desktop layout
        side by side and letting CSS hide one duplicates every interactive
        control and every id inside the panes — two editors, two AI panels —
        which assistive technology reads twice and which breaks label
        association. So the panes are rendered once and only their visibility
        is responsive.
      */}
      <div role="tablist" aria-label="Workspace panes" className="flex border-b border-neutral-200 lg:hidden">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`pane-tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`pane-panel-${tab.id}`}
            // Only the active tab is in the tab order; arrow keys move between
            // them, which is the expected tablist pattern.
            tabIndex={active === tab.id ? 0 : -1}
            onClick={() => setActive(tab.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const i = TABS.findIndex((t) => t.id === active);
              const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
              setActive(TABS[next].id);
              document.getElementById(`pane-tab-${TABS[next].id}`)?.focus();
            }}
            className={`flex-1 px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900 ${
              active === tab.id
                ? "border-b-2 border-neutral-900 font-medium text-neutral-900"
                : "text-neutral-500"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 lg:grid lg:grid-cols-[220px_1fr_360px]">
        {TABS.map((tab) => (
          <div
            key={tab.id}
            role="tabpanel"
            id={`pane-panel-${tab.id}`}
            aria-labelledby={`pane-tab-${tab.id}`}
            // Inactive panes stay MOUNTED and are hidden with a class, so
            // switching tabs never discards editor text or an AI suggestion
            // waiting for review. On desktop every pane is shown and the
            // original three-column grid is unchanged.
            className={`min-h-0 overflow-y-auto lg:block lg:overflow-visible ${
              active === tab.id ? "block h-full" : "hidden"
            } ${tab.id === "navigator" ? "lg:border-r lg:border-neutral-200" : ""} ${
              tab.id === "assistant" ? "lg:border-l lg:border-neutral-200" : ""
            }`}
          >
            {panes[tab.id]}
          </div>
        ))}
      </div>
    </div>
  );
}
