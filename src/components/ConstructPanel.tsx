"use client";

import { useState } from "react";
import AISuggestionCard from "@/components/AISuggestionCard";
import ConstructTracePanel from "@/components/ConstructTracePanel";
import { CONSTRUCT_ROLE_LABELS } from "@/lib/db/types";
import type { ConstructRole, ResearchConstructRow, ResearchIndicatorRow } from "@/lib/db/types";
import type { RewriteProposal } from "@/lib/methodology/suggestions";

/**
 * Constructs, their two definitions and their indicators (§7, §9).
 *
 * The two definitions are separate fields rather than one "definition" box,
 * because the gap between them is the thing worth seeing: a construct with a
 * conceptual definition and no operational one is defined but unmeasurable, and
 * that is the most common measurement gap there is. One combined field would
 * hide it behind a filled-in textarea.
 */
const ROLES: ConstructRole[] = [
  "independent", "dependent", "mediator", "moderator", "control", "demographic", "latent",
];

export default function ConstructPanel({
  projectId,
  constructs,
  indicators,
  busy,
  onAdd,
  onUpdate,
  onDelete,
  onAddIndicator,
  onSuggestDefinition,
  onAcceptDefinition,
  onRejectDefinition,
  definitionSuggestions,
  suggestionsFor,
}: {
  /** Optional so existing callers and tests that only exercise the editing
   *  behaviour keep working; without it the traceability panel, which is the
   *  only part that needs to fetch, is simply not offered. */
  projectId?: string;
  constructs: ResearchConstructRow[];
  indicators: ResearchIndicatorRow[];
  busy?: boolean;
  onAdd: (name: string, role: ConstructRole) => void | Promise<void>;
  onUpdate: (
    constructId: string,
    patch: { conceptualDefinition?: string; operationalDefinition?: string; role?: ConstructRole; confirmed?: boolean },
  ) => void | Promise<void>;
  onDelete: (constructId: string) => void | Promise<void>;
  onAddIndicator: (constructId: string, name: string, dimension: string | null) => void | Promise<void>;
  onSuggestDefinition?: (constructId: string) => void | Promise<void>;
  onAcceptDefinition?: (constructId: string, text: string) => void | Promise<void>;
  onRejectDefinition?: (proposal: RewriteProposal) => void | Promise<void>;
  definitionSuggestions?: RewriteProposal[] | null;
  suggestionsFor?: string | null;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState<ConstructRole>("latent");
  const [open, setOpen] = useState<string | null>(null);
  const [indicatorName, setIndicatorName] = useState("");
  const [indicatorDimension, setIndicatorDimension] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          void onAdd(name.trim(), role);
          setName("");
        }}
        className="flex flex-wrap gap-2"
      >
        <label htmlFor="new-construct" className="sr-only">
          New construct name
        </label>
        <input
          id="new-construct"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Add a construct or variable"
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-xs focus:border-neutral-500 focus:outline-none"
        />
        <label htmlFor="new-construct-role" className="sr-only">
          Role in the study
        </label>
        <select
          id="new-construct-role"
          value={role}
          onChange={(e) => setRole(e.target.value as ConstructRole)}
          className="rounded border border-neutral-300 px-2 py-1.5 text-xs"
        >
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {CONSTRUCT_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || !name.trim()}
          className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Add
        </button>
      </form>

      {constructs.length === 0 ? (
        <p className="rounded border border-neutral-200 p-4 text-center text-xs text-neutral-600">
          No constructs yet. These are the concepts your questions are about — everything the questionnaire
          measures hangs off them.
        </p>
      ) : (
        <ul className="space-y-2">
          {constructs.map((construct) => {
            const own = indicators.filter((i) => i.construct_id === construct.id);
            const isOpen = open === construct.id;

            return (
              <li key={construct.id} className="rounded border border-neutral-200">
                <div className="flex flex-wrap items-start justify-between gap-2 p-2.5">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">
                      {construct.name}
                      {construct.provenance === "ai_suggested" && !construct.confirmed && (
                        <span className="ml-1.5 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-900">
                          AI SUGGESTED
                        </span>
                      )}
                    </p>
                    <p className="mt-0.5 text-[11px] text-neutral-500">
                      {CONSTRUCT_ROLE_LABELS[construct.role]} ·{" "}
                      {own.length === 0 ? "no indicators" : `${own.length} indicator${own.length === 1 ? "" : "s"}`}
                      {construct.operational_definition ? "" : " · no operational definition"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {construct.provenance === "ai_suggested" && !construct.confirmed && (
                      <button
                        type="button"
                        onClick={() => void onUpdate(construct.id, { confirmed: true })}
                        disabled={busy}
                        className="rounded border border-neutral-300 px-2 py-1 text-[11px] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                      >
                        Confirm
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setOpen(isOpen ? null : construct.id)}
                      aria-expanded={isOpen}
                      className="rounded border border-neutral-300 px-2 py-1 text-[11px] focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                    >
                      {isOpen ? "Close" : "Edit"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void onDelete(construct.id)}
                      disabled={busy}
                      className="rounded border border-neutral-300 px-2 py-1 text-[11px] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {isOpen && (
                  <div className="space-y-2 border-t border-neutral-200 p-2.5">
                    <div>
                      <label
                        htmlFor={`conceptual-${construct.id}`}
                        className="text-[11px] font-medium text-neutral-700"
                      >
                        Conceptual definition — what the concept means
                      </label>
                      <textarea
                        id={`conceptual-${construct.id}`}
                        defaultValue={construct.conceptual_definition ?? ""}
                        onBlur={(e) => void onUpdate(construct.id, { conceptualDefinition: e.target.value })}
                        rows={2}
                        className="mt-1 w-full resize-y rounded border border-neutral-300 p-1.5 text-xs focus:border-neutral-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor={`operational-${construct.id}`}
                        className="text-[11px] font-medium text-neutral-700"
                      >
                        Operational definition — how it will be observed
                      </label>
                      <textarea
                        id={`operational-${construct.id}`}
                        defaultValue={construct.operational_definition ?? ""}
                        onBlur={(e) => void onUpdate(construct.id, { operationalDefinition: e.target.value })}
                        rows={2}
                        className="mt-1 w-full resize-y rounded border border-neutral-300 p-1.5 text-xs focus:border-neutral-500 focus:outline-none"
                      />
                      {onSuggestDefinition && (
                        <button
                          type="button"
                          onClick={() => void onSuggestDefinition(construct.id)}
                          disabled={busy}
                          className="mt-1 rounded border border-neutral-300 px-2 py-1 text-[11px] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                        >
                          Suggest wording
                        </button>
                      )}
                    </div>

                    {suggestionsFor === construct.id && definitionSuggestions && (
                      <ul className="space-y-1.5">
                        {definitionSuggestions.map((proposal, i) => (
                          <AISuggestionCard
                            key={i}
                            title="Operational definition"
                            rationale={proposal.change}
                            editableText={drafts[`${construct.id}-${i}`] ?? proposal.text}
                            onEditableTextChange={(text) =>
                              setDrafts((prev) => ({ ...prev, [`${construct.id}-${i}`]: text }))
                            }
                            busy={busy}
                            acceptLabel="Use this"
                            onAccept={() =>
                              void onAcceptDefinition?.(
                                construct.id,
                                drafts[`${construct.id}-${i}`] ?? proposal.text,
                              )
                            }
                            onReject={() => void onRejectDefinition?.(proposal)}
                          />
                        ))}
                      </ul>
                    )}

                    <div>
                      <p className="text-[11px] font-medium text-neutral-700">Indicators</p>
                      {own.length === 0 ? (
                        <p className="mt-1 text-[11px] text-neutral-500">
                          None yet. Indicators are the observable parts a questionnaire item can ask about.
                        </p>
                      ) : (
                        <ul className="mt-1 space-y-0.5">
                          {own.map((indicator) => (
                            <li key={indicator.id} className="rounded bg-neutral-50 px-2 py-1 text-[11px]">
                              {indicator.name}
                              {indicator.dimension ? ` · ${indicator.dimension}` : ""}
                            </li>
                          ))}
                        </ul>
                      )}

                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!indicatorName.trim()) return;
                          void onAddIndicator(
                            construct.id,
                            indicatorName.trim(),
                            indicatorDimension.trim() || null,
                          );
                          setIndicatorName("");
                          setIndicatorDimension("");
                        }}
                        className="mt-1.5 flex flex-wrap gap-1.5"
                      >
                        <label htmlFor={`indicator-name-${construct.id}`} className="sr-only">
                          New indicator name
                        </label>
                        <input
                          id={`indicator-name-${construct.id}`}
                          value={indicatorName}
                          onChange={(e) => setIndicatorName(e.target.value)}
                          placeholder="Indicator"
                          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-[11px] focus:border-neutral-500 focus:outline-none"
                        />
                        <label htmlFor={`indicator-dimension-${construct.id}`} className="sr-only">
                          Dimension (optional)
                        </label>
                        <input
                          id={`indicator-dimension-${construct.id}`}
                          value={indicatorDimension}
                          onChange={(e) => setIndicatorDimension(e.target.value)}
                          placeholder="Dimension (optional)"
                          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-[11px] focus:border-neutral-500 focus:outline-none"
                        />
                        <button
                          type="submit"
                          disabled={busy || !indicatorName.trim()}
                          className="rounded border border-neutral-300 px-2 py-1 text-[11px] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                        >
                          Add indicator
                        </button>
                      </form>
                    </div>

                    {/* Phase 21 §25. Fetched only when the construct is open,
                        so a workspace with thirty constructs does not pay for
                        thirty traces to render a list of names. */}
                    {projectId && (
                      <details className="rounded border border-neutral-200 px-2 py-1.5">
                        <summary className="cursor-pointer text-[11px] text-neutral-700">
                          What depends on this concept
                        </summary>
                        <div className="mt-2">
                          <ConstructTracePanel projectId={projectId} constructId={construct.id} />
                        </div>
                      </details>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
