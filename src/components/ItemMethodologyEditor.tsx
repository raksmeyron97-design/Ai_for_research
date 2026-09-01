"use client";

import { useState } from "react";
import AISuggestionCard from "@/components/AISuggestionCard";
import { ADAPTATION_TYPE_LABELS, PROVENANCE_LABELS } from "@/lib/db/types";
import type {
  QuestionnaireQuestionRow,
  ResearchConstructRow,
  ResearchIndicatorRow,
  ResearchScaleRow,
} from "@/lib/db/types";
import type { MappingProposal } from "@/lib/methodology/suggestions";

/**
 * One questionnaire item's methodology metadata (§22).
 *
 * This edits the same `questionnaire_questions` row the Phase 6 builder has
 * always edited — the whole point of §22 is that Phase 18 adds mapping to the
 * questionnaire rather than replacing it with a second one.
 *
 * Provenance is shown, never inferred. An item the assistant proposed stays
 * labelled as a suggestion until the researcher confirms it is theirs, and the
 * source fields are only editable by the researcher: nothing in the AI path can
 * reach them, because no suggestion carries a citation.
 */
export default function ItemMethodologyEditor({
  item,
  constructs,
  indicators,
  scales,
  busy,
  onChange,
  onSuggestMapping,
  suggestions,
  onAcceptSuggestion,
  onRejectSuggestion,
}: {
  item: QuestionnaireQuestionRow;
  constructs: ResearchConstructRow[];
  indicators: ResearchIndicatorRow[];
  scales: ResearchScaleRow[];
  busy?: boolean;
  onChange: (patch: Record<string, unknown>) => void | Promise<void>;
  onSuggestMapping?: (itemId: string) => void | Promise<void>;
  suggestions?: MappingProposal[] | null;
  onAcceptSuggestion?: (proposal: MappingProposal) => void | Promise<void>;
  onRejectSuggestion?: (proposal: MappingProposal) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);

  const constructName = new Map(constructs.map((c) => [c.id, c.name]));
  const indicatorName = new Map(indicators.map((i) => [i.id, i.name]));
  // Only the indicators under the chosen construct: offering the rest invites
  // a mapping the coverage matrix cannot represent.
  const availableIndicators = item.construct_id
    ? indicators.filter((i) => i.construct_id === item.construct_id)
    : indicators;

  const unmapped = !item.construct_id && !item.indicator_id;

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="text-[11px] text-neutral-600 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
      >
        {open ? "Hide measurement details" : "Measurement details"}
      </button>

      <p className="mt-0.5 text-[11px] text-neutral-500">
        {unmapped ? (
          <span className="text-amber-800">Not linked to a construct — measures nothing yet.</span>
        ) : (
          <>
            {item.construct_id ? constructName.get(item.construct_id) ?? "Unknown construct" : "No construct"}
            {item.indicator_id ? ` · ${indicatorName.get(item.indicator_id) ?? "Unknown indicator"}` : ""}
            {item.reverse_coded ? " · reverse-coded" : ""}
          </>
        )}
        {item.item_provenance !== "user" && ` · ${PROVENANCE_LABELS[item.item_provenance]}`}
        {item.adaptation_type && ` · ${ADAPTATION_TYPE_LABELS[item.adaptation_type]}`}
      </p>

      {open && (
        <div className="mt-1.5 space-y-2 rounded border border-neutral-200 p-2">
          <div className="flex flex-wrap gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor={`item-construct-${item.id}`} className="text-[11px] font-medium text-neutral-700">
                Construct
              </label>
              <select
                id={`item-construct-${item.id}`}
                value={item.construct_id ?? ""}
                onChange={(e) =>
                  // Changing the construct clears the indicator: an indicator
                  // under the old construct would be a mapping that contradicts
                  // itself, and §11 counts that as an error.
                  void onChange({ constructId: e.target.value || null, indicatorId: null })
                }
                className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-[11px]"
              >
                <option value="">Not linked</option>
                {constructs.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="min-w-0 flex-1">
              <label htmlFor={`item-indicator-${item.id}`} className="text-[11px] font-medium text-neutral-700">
                Indicator
              </label>
              <select
                id={`item-indicator-${item.id}`}
                value={item.indicator_id ?? ""}
                onChange={(e) => void onChange({ indicatorId: e.target.value || null })}
                className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-[11px]"
              >
                <option value="">Not linked</option>
                {availableIndicators.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor={`item-scale-${item.id}`} className="text-[11px] font-medium text-neutral-700">
                Response scale
              </label>
              <select
                id={`item-scale-${item.id}`}
                value={item.scale_id ?? ""}
                onChange={(e) => void onChange({ scaleId: e.target.value || null })}
                className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-[11px]"
              >
                <option value="">None</option>
                {scales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>

            <label className="flex items-center gap-1.5 text-[11px]">
              <input
                type="checkbox"
                checked={item.reverse_coded}
                onChange={(e) => void onChange({ reverseCoded: e.target.checked })}
                className="h-3.5 w-3.5"
              />
              Reverse-coded
            </label>
          </div>

          {item.item_provenance === "ai_suggested" && (
            <div className="rounded bg-violet-50 p-1.5">
              <p className="text-[11px] text-violet-900">
                This item was suggested by the assistant. Confirming marks it as your own wording.
              </p>
              <button
                type="button"
                onClick={() => void onChange({ itemProvenance: "user" })}
                disabled={busy}
                className="mt-1 rounded border border-violet-300 px-2 py-0.5 text-[11px] text-violet-900 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-900"
              >
                Confirm as mine
              </button>
            </div>
          )}

          {onSuggestMapping && (
            <button
              type="button"
              onClick={() => void onSuggestMapping(item.id)}
              disabled={busy || constructs.length === 0}
              className="rounded border border-neutral-300 px-2 py-1 text-[11px] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
            >
              Suggest a mapping
            </button>
          )}

          {suggestions && (
            <ul className="space-y-1.5">
              {suggestions.length === 0 ? (
                <li className="text-[11px] text-neutral-500">
                  No mapping suggestion fitted the constructs in this project.
                </li>
              ) : (
                suggestions.map((proposal, i) => (
                  <AISuggestionCard
                    key={i}
                    title={
                      proposal.constructId
                        ? constructName.get(proposal.constructId) ?? "Unknown construct"
                        : "Indicator only"
                    }
                    rationale={proposal.rationale}
                    meta={`Confidence the model reported: ${proposal.confidence}${
                      proposal.indicatorId
                        ? ` · ${indicatorName.get(proposal.indicatorId) ?? "unknown indicator"}`
                        : ""
                    }`}
                    busy={busy}
                    acceptLabel="Use this mapping"
                    onAccept={() => void onAcceptSuggestion?.(proposal)}
                    onReject={() => void onRejectSuggestion?.(proposal)}
                  />
                ))
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
