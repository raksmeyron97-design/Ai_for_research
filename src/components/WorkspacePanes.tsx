"use client";

import { useState, type ReactNode } from "react";

/**
 * Phase 17 §24 / Phase 17B §30.
 *
 * Desktop keeps the three-column grid: Navigator | Editor | aside. Phase 17B
 * adds three more panes (Review, Evidence, History) and they all live in the
 * aside column as an inner tab group, because a fifth and sixth column is not
 * a layout — it is four unreadable columns.
 *
 * Below `lg` every pane becomes a tab in one row: Sections → Editor → Review →
 * Evidence → AI → History. Tabs rather than a drawer-over-drawer because the
 * panes are peers, not a hierarchy: on a phone a researcher is either
 * navigating, writing, reviewing or asking — never usefully doing two at once
 * in 375px.
 *
 * **One DOM tree, not two.** Rendering a mobile layout beside a desktop layout
 * and hiding one with CSS duplicates every interactive control and every id
 * inside the panes — two editors, two AI panels — which assistive technology
 * reads twice and which breaks label association. So panes render once and
 * only their visibility is responsive.
 *
 * **Panes stay mounted.** Switching tabs never discards editor text, an AI
 * suggestion waiting for review, or a half-finished evidence preview. They are
 * hidden with a class, not unmounted — which is also why no business logic is
 * duplicated for mobile: there is only one of each pane.
 */
export type PaneRegion = "navigator" | "editor" | "aside";

export interface WorkspacePane {
  id: string;
  label: string;
  region: PaneRegion;
  node: ReactNode;
}

function Tablist({
  id,
  label,
  panes,
  active,
  onSelect,
  className,
}: {
  id: string;
  label: string;
  panes: WorkspacePane[];
  active: string;
  onSelect: (paneId: string) => void;
  className: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={className}>
      {panes.map((pane) => (
        <button
          key={pane.id}
          type="button"
          role="tab"
          id={`${id}-tab-${pane.id}`}
          aria-selected={active === pane.id}
          aria-controls={`pane-panel-${pane.id}`}
          // Only the active tab is in the tab order; arrow keys move between
          // them, which is the expected tablist pattern.
          tabIndex={active === pane.id ? 0 : -1}
          onClick={() => onSelect(pane.id)}
          onKeyDown={(e) => {
            if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
            e.preventDefault();
            const i = panes.findIndex((p) => p.id === active);
            const next = e.key === "ArrowRight" ? (i + 1) % panes.length : (i - 1 + panes.length) % panes.length;
            onSelect(panes[next].id);
            document.getElementById(`${id}-tab-${panes[next].id}`)?.focus();
          }}
          className={`flex-1 whitespace-nowrap px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900 ${
            active === pane.id
              ? "border-b-2 border-neutral-900 font-medium text-neutral-900"
              : "text-neutral-500"
          }`}
        >
          {pane.label}
        </button>
      ))}
    </div>
  );
}

export default function WorkspacePanes({
  panes,
  activeAside,
  onAsideChange,
}: {
  panes: WorkspacePane[];
  /** Controlled by the parent so a review issue can switch the aside to Evidence (§27). */
  activeAside: string;
  onAsideChange: (paneId: string) => void;
}) {
  const [activeMobile, setActiveMobile] = useState<string>(
    () => panes.find((p) => p.region === "editor")?.id ?? panes[0]?.id ?? "",
  );

  const asidePanes = panes.filter((p) => p.region === "aside");

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Tablist
        id="mobile"
        label="Workspace panes"
        panes={panes}
        active={activeMobile}
        onSelect={setActiveMobile}
        className="flex overflow-x-auto border-b border-neutral-200 lg:hidden"
      />

      <div className="min-h-0 flex-1 lg:grid lg:grid-cols-[220px_1fr_380px]">
        {panes
          .filter((p) => p.region !== "aside")
          .map((pane) => (
            <div
              key={pane.id}
              role="tabpanel"
              id={`pane-panel-${pane.id}`}
              aria-labelledby={`mobile-tab-${pane.id}`}
              className={`min-h-0 overflow-y-auto lg:block lg:overflow-visible ${
                activeMobile === pane.id ? "block h-full" : "hidden"
              } ${pane.region === "navigator" ? "lg:border-r lg:border-neutral-200" : ""}`}
            >
              {pane.node}
            </div>
          ))}

        <div
          className={`min-h-0 flex-col lg:flex lg:border-l lg:border-neutral-200 ${
            asidePanes.some((p) => p.id === activeMobile) ? "flex h-full" : "hidden"
          }`}
        >
          <Tablist
            id="aside"
            label="Assistant panes"
            panes={asidePanes}
            active={activeAside}
            onSelect={onAsideChange}
            // The inner tab row is desktop-only: on mobile these panes are
            // already reachable from the main row, and a second row of tabs
            // above them would be the same choice offered twice.
            className="hidden border-b border-neutral-200 lg:flex"
          />

          {asidePanes.map((pane) => (
            <div
              key={pane.id}
              role="tabpanel"
              id={`pane-panel-${pane.id}`}
              aria-labelledby={`mobile-tab-${pane.id}`}
              className={`min-h-0 overflow-y-auto ${activeMobile === pane.id ? "block h-full" : "hidden"} ${
                activeAside === pane.id ? "lg:block lg:h-full" : "lg:hidden"
              }`}
            >
              {pane.node}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
