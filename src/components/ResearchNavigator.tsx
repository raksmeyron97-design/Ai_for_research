"use client";

import { SECTION_CHAIN, SECTION_LABELS } from "@/lib/db/types";
import type { SectionStatus, SectionType } from "@/lib/db/types";

const STATUS_ICON: Record<SectionStatus, string> = {
  completed: "✓",
  in_progress: "●",
  not_started: "○",
};

const STATUS_COLOR: Record<SectionStatus, string> = {
  completed: "text-green-600",
  in_progress: "text-amber-500",
  not_started: "text-neutral-300",
};

export default function ResearchNavigator({
  statuses,
  activeSectionType,
  onSelect,
}: {
  statuses: Record<SectionType, SectionStatus>;
  activeSectionType: SectionType;
  onSelect: (sectionType: SectionType) => void;
}) {
  return (
    <nav className="flex h-full flex-col gap-0.5 overflow-y-auto p-2 text-sm">
      {SECTION_CHAIN.map((sectionType) => {
        const status = statuses[sectionType] ?? "not_started";
        const isActive = sectionType === activeSectionType;
        return (
          <button
            key={sectionType}
            type="button"
            onClick={() => onSelect(sectionType)}
            className={`flex items-center gap-2 rounded px-2 py-1.5 text-left ${
              isActive ? "bg-neutral-900 text-white" : "hover:bg-neutral-100"
            }`}
          >
            <span className={isActive ? "text-white" : STATUS_COLOR[status]}>
              {STATUS_ICON[status]}
            </span>
            <span className="truncate">{SECTION_LABELS[sectionType]}</span>
          </button>
        );
      })}
    </nav>
  );
}
