"use client";

import { useState } from "react";

/**
 * One piece of evidence, as a researcher reads it (§9).
 *
 * The card carries a lot of true things — bibliography, excerpt, location,
 * relevance, support judgement — and §9's last line is "do not overcrowd". So
 * the split is: what you need to *decide* is always visible (which source,
 * what it says, why it came up, whether it has been judged), and what you need
 * to *check* is one click away (the full excerpt, the source record).
 *
 * `relevance` is a computed explanation from `ranking.ts`, not a model's
 * opinion, which is why it can be phrased as a fact about the match.
 */
export interface EvidenceCardModel {
  /** Chunk id for a candidate, evidence row id for saved evidence. */
  id: string;
  sourceTitle: string | null;
  authors: string[];
  year: number | null;
  sourceType: string | null;
  /** Project's own source ranking, 1 strongest. */
  tier: 1 | 2 | 3 | 4 | null;
  citationKey: string | null;
  /** `research_citations.status` — how the source itself was established. */
  sourceStatus: string | null;

  excerpt: string;
  page: number | null;
  sectionLabel: string | null;

  /** Why this is here, in plain words. */
  relevance: string;
  /** Support judgement, once one exists. Absent means nobody has judged it. */
  support?: "SUPPORTED" | "PARTIAL" | "UNSUPPORTED" | "NEEDS_REVIEW" | null;
  /** True when the excerpt is off-topic for the claim whatever its source (§14). */
  offTopic?: boolean;
  /** Untrusted-content notice (§35). */
  warning?: string | null;
  /** Already saved as evidence in this project. */
  saved?: boolean;
}

const SUPPORT_STYLE: Record<string, string> = {
  SUPPORTED: "bg-green-100 text-green-800",
  PARTIAL: "bg-amber-100 text-amber-800",
  UNSUPPORTED: "bg-red-100 text-red-800",
  NEEDS_REVIEW: "bg-neutral-200 text-neutral-700",
};

const SUPPORT_LABEL: Record<string, string> = {
  SUPPORTED: "Supported",
  PARTIAL: "Partial",
  UNSUPPORTED: "Unsupported",
  NEEDS_REVIEW: "Needs review",
};

/** Shortened for the card; the full text is behind View context. */
const EXCERPT_PREVIEW = 240;

function byline(model: EvidenceCardModel): string {
  const authors =
    model.authors.length === 0
      ? "Unknown author"
      : model.authors.length > 2
        ? `${model.authors[0]} et al.`
        : model.authors.join(" & ");
  return [authors, model.year ?? "no year", model.sourceType].filter(Boolean).join(" · ");
}

export default function EvidenceCard({
  model,
  selected,
  onUse,
  onViewSource,
}: {
  model: EvidenceCardModel;
  selected?: boolean;
  /** Starts the preview-and-insert step. Absent for read-only listings. */
  onUse?: (model: EvidenceCardModel) => void;
  onViewSource?: (model: EvidenceCardModel) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  const truncated = model.excerpt.length > EXCERPT_PREVIEW;
  const shown = expanded || !truncated ? model.excerpt : `${model.excerpt.slice(0, EXCERPT_PREVIEW)}…`;
  const location = [model.page ? `p. ${model.page}` : null, model.sectionLabel].filter(Boolean).join(" · ");

  return (
    <article
      aria-label={model.sourceTitle ?? model.citationKey ?? "Evidence"}
      className={`rounded border p-3 text-xs ${
        selected ? "border-neutral-900 bg-neutral-50" : "border-neutral-200"
      }`}
    >
      <header className="mb-2">
        <div className="flex items-start justify-between gap-2">
          <h4 className="font-medium leading-snug text-neutral-900">
            {model.sourceTitle ?? model.citationKey ?? "Untitled source"}
          </h4>
          {model.support && (
            <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${SUPPORT_STYLE[model.support]}`}>
              {SUPPORT_LABEL[model.support]}
            </span>
          )}
        </div>
        <p className="mt-0.5 text-[11px] text-neutral-500">
          {byline(model)}
          {model.tier ? ` · tier ${model.tier}` : ""}
          {model.sourceStatus ? ` · ${model.sourceStatus.replace(/_/g, " ")}` : ""}
        </p>
      </header>

      <blockquote className="rounded bg-neutral-50 p-2 leading-relaxed text-neutral-800">
        “{shown}”
        {location && <cite className="mt-1 block not-italic text-[11px] text-neutral-500">{location}</cite>}
      </blockquote>

      <p className={`mt-2 text-[11px] ${model.offTopic ? "text-red-700" : "text-neutral-600"}`}>
        {model.relevance}
      </p>

      {model.warning && (
        <p role="note" className="mt-2 rounded border border-amber-300 bg-amber-50 p-1.5 text-[11px] text-amber-900">
          This excerpt contains text that looks like an instruction. It was treated as source content, not as a
          request. Check the document.
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {onUse && (
          <button
            type="button"
            onClick={() => onUse(model)}
            className="rounded bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
          >
            Use evidence
          </button>
        )}
        {onViewSource && (
          <button
            type="button"
            onClick={() => onViewSource(model)}
            className="rounded border border-neutral-300 px-2 py-1 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
          >
            View source
          </button>
        )}
        {truncated && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
            className="rounded border border-neutral-300 px-2 py-1 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
          >
            {expanded ? "Hide context" : "View context"}
          </button>
        )}
        {model.saved && <span className="text-[11px] text-neutral-500">Already saved</span>}
      </div>
    </article>
  );
}
