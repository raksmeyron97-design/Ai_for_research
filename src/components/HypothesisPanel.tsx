"use client";

import { useState } from "react";
import AISuggestionCard from "@/components/AISuggestionCard";
import { HYPOTHESIS_FORM_LABELS, HYPOTHESIS_POSITION_LABELS } from "@/lib/db/types";
import type {
  HypothesisForm,
  HypothesisPosition,
  ResearchConstructRow,
  ResearchHypothesisRow,
  ResearchHypothesisVariableRow,
  ResearchObjectiveRow,
} from "@/lib/db/types";
import type { HypothesisProposal } from "@/lib/methodology/suggestions";

/**
 * Hypotheses and the constructs they relate (§8).
 *
 * A hypothesis is shown with its variable positions rather than as a sentence
 * alone, because the sentence is not what gets checked — "X is associated with
 * Y" tells the engine nothing until X and Y are the constructs the study
 * actually measures. The positions are the part that makes a hypothesis
 * testable, so they are the part that is visible.
 */
const FORMS: HypothesisForm[] = [
  "association", "prediction", "difference", "mediation", "moderation", "descriptive", "unclassified",
];
const POSITIONS: HypothesisPosition[] = ["predictor", "outcome", "mediator", "moderator", "control"];

export default function HypothesisPanel({
  hypotheses,
  links,
  constructs,
  objectives,
  busy,
  onAdd,
  onDelete,
  onLink,
  onUnlink,
  onSuggest,
  onAcceptSuggestion,
  onRejectSuggestion,
  suggestions,
}: {
  hypotheses: ResearchHypothesisRow[];
  links: ResearchHypothesisVariableRow[];
  constructs: ResearchConstructRow[];
  objectives: ResearchObjectiveRow[];
  busy?: boolean;
  onAdd: (input: { statement: string; label: string | null; form: HypothesisForm; objectiveId: string | null }) => void | Promise<void>;
  onDelete: (hypothesisId: string) => void | Promise<void>;
  onLink: (hypothesisId: string, constructId: string, position: HypothesisPosition) => void | Promise<void>;
  onUnlink: (hypothesisId: string, linkId: string) => void | Promise<void>;
  onSuggest?: () => void | Promise<void>;
  onAcceptSuggestion?: (proposal: HypothesisProposal, statement: string) => void | Promise<void>;
  onRejectSuggestion?: (proposal: HypothesisProposal) => void | Promise<void>;
  suggestions?: HypothesisProposal[] | null;
}) {
  const [statement, setStatement] = useState("");
  const [label, setLabel] = useState("");
  const [form, setForm] = useState<HypothesisForm>("association");
  const [objectiveId, setObjectiveId] = useState("");
  const [linkDraft, setLinkDraft] = useState<Record<string, { constructId: string; position: HypothesisPosition }>>({});
  const [edited, setEdited] = useState<Record<number, string>>({});

  const constructName = new Map(constructs.map((c) => [c.id, c.name]));

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!statement.trim()) return;
          void onAdd({
            statement: statement.trim(),
            label: label.trim() || null,
            form,
            objectiveId: objectiveId || null,
          });
          setStatement("");
          setLabel("");
        }}
        className="space-y-2"
      >
        <div className="flex flex-wrap gap-2">
          <label htmlFor="hypothesis-label" className="sr-only">
            Hypothesis label
          </label>
          <input
            id="hypothesis-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="H1"
            className="w-16 rounded border border-neutral-300 px-2 py-1.5 text-xs focus:border-neutral-500 focus:outline-none"
          />
          <label htmlFor="hypothesis-statement" className="sr-only">
            Hypothesis statement
          </label>
          <input
            id="hypothesis-statement"
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            placeholder="State the hypothesis"
            className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-xs focus:border-neutral-500 focus:outline-none"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <label htmlFor="hypothesis-form" className="sr-only">
            Hypothesis form
          </label>
          <select
            id="hypothesis-form"
            value={form}
            onChange={(e) => setForm(e.target.value as HypothesisForm)}
            className="rounded border border-neutral-300 px-2 py-1.5 text-xs"
          >
            {FORMS.map((f) => (
              <option key={f} value={f}>
                {HYPOTHESIS_FORM_LABELS[f]}
              </option>
            ))}
          </select>
          <label htmlFor="hypothesis-objective" className="sr-only">
            Objective this hypothesis serves
          </label>
          <select
            id="hypothesis-objective"
            value={objectiveId}
            onChange={(e) => setObjectiveId(e.target.value)}
            className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-xs"
          >
            <option value="">No objective yet</option>
            {objectives.map((o) => (
              <option key={o.id} value={o.id}>
                {o.objective_text.slice(0, 60)}
              </option>
            ))}
          </select>
          <button
            type="submit"
            disabled={busy || !statement.trim()}
            className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
          >
            Add hypothesis
          </button>
          {onSuggest && (
            <button
              type="button"
              onClick={() => void onSuggest()}
              disabled={busy}
              className="rounded border border-neutral-300 px-3 py-1.5 text-xs disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
            >
              Suggest hypotheses
            </button>
          )}
        </div>
      </form>

      {suggestions && (
        <ul className="space-y-1.5">
          {suggestions.length === 0 ? (
            <li className="text-[11px] text-neutral-500">No hypothesis suggestions came back.</li>
          ) : (
            suggestions.map((proposal, i) => (
              <AISuggestionCard
                key={i}
                title={HYPOTHESIS_FORM_LABELS[proposal.form]}
                rationale={proposal.rationale}
                editableText={edited[i] ?? proposal.statement}
                onEditableTextChange={(text) => setEdited((prev) => ({ ...prev, [i]: text }))}
                meta={proposal.variables
                  .map((v) => `${constructName.get(v.constructId) ?? "?"} (${HYPOTHESIS_POSITION_LABELS[v.position].toLowerCase()})`)
                  .join(" · ")}
                busy={busy}
                // A proposal with no outcome states no result to observe. That
                // is computed from the links, not read off the form the model
                // chose for itself.
                disabledReason={proposal.hasOutcome ? undefined : "This suggestion names no outcome, so it cannot be tested as written."}
                // Distinct from the form's own "Add hypothesis" button: two
                // controls with the same accessible name on one screen is
                // ambiguous to a screen reader, not only to a test.
                acceptLabel="Add this hypothesis"
                onAccept={() => void onAcceptSuggestion?.(proposal, edited[i] ?? proposal.statement)}
                onReject={() => void onRejectSuggestion?.(proposal)}
              />
            ))
          )}
        </ul>
      )}

      {hypotheses.length === 0 ? (
        <p className="rounded border border-neutral-200 p-4 text-center text-xs text-neutral-600">
          No hypotheses yet. Descriptive and exploratory studies often have none — add them only if your
          questions predict a relationship.
        </p>
      ) : (
        <ul className="space-y-2">
          {hypotheses.map((hypothesis) => {
            const own = links.filter((l) => l.hypothesis_id === hypothesis.id);
            const draft = linkDraft[hypothesis.id] ?? { constructId: "", position: "predictor" as HypothesisPosition };

            return (
              <li key={hypothesis.id} className="rounded border border-neutral-200 p-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">
                      {hypothesis.label ? `${hypothesis.label}: ` : ""}
                      {hypothesis.statement}
                    </p>
                    <p className="mt-0.5 text-[11px] text-neutral-500">
                      {HYPOTHESIS_FORM_LABELS[hypothesis.hypothesis_form]}
                      {hypothesis.direction !== "unspecified" ? ` · ${hypothesis.direction}` : ""}
                      {hypothesis.analysis_method ? ` · ${hypothesis.analysis_method}` : " · no analysis method"}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void onDelete(hypothesis.id)}
                    disabled={busy}
                    className="shrink-0 rounded border border-neutral-300 px-2 py-1 text-[11px] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                  >
                    Delete
                  </button>
                </div>

                {own.length === 0 ? (
                  <p className="mt-2 text-[11px] text-amber-800">
                    No constructs linked yet, so nothing about this hypothesis can be checked.
                  </p>
                ) : (
                  <ul className="mt-2 space-y-0.5">
                    {own.map((link) => (
                      <li
                        key={link.id}
                        className="flex items-center justify-between gap-2 rounded bg-neutral-50 px-2 py-1 text-[11px]"
                      >
                        <span>
                          {constructName.get(link.construct_id) ?? "Unknown construct"} ·{" "}
                          {HYPOTHESIS_POSITION_LABELS[link.position]}
                        </span>
                        <button
                          type="button"
                          onClick={() => void onUnlink(hypothesis.id, link.id)}
                          disabled={busy}
                          className="text-neutral-500 underline disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  <label htmlFor={`link-construct-${hypothesis.id}`} className="sr-only">
                    Construct to link
                  </label>
                  <select
                    id={`link-construct-${hypothesis.id}`}
                    value={draft.constructId}
                    onChange={(e) =>
                      setLinkDraft((prev) => ({
                        ...prev,
                        [hypothesis.id]: { ...draft, constructId: e.target.value },
                      }))
                    }
                    className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1 text-[11px]"
                  >
                    <option value="">Choose a construct</option>
                    {constructs.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                  <label htmlFor={`link-position-${hypothesis.id}`} className="sr-only">
                    Position in the hypothesis
                  </label>
                  <select
                    id={`link-position-${hypothesis.id}`}
                    value={draft.position}
                    onChange={(e) =>
                      setLinkDraft((prev) => ({
                        ...prev,
                        [hypothesis.id]: { ...draft, position: e.target.value as HypothesisPosition },
                      }))
                    }
                    className="rounded border border-neutral-300 px-2 py-1 text-[11px]"
                  >
                    {POSITIONS.map((p) => (
                      <option key={p} value={p}>
                        {HYPOTHESIS_POSITION_LABELS[p]}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (!draft.constructId) return;
                      void onLink(hypothesis.id, draft.constructId, draft.position);
                      setLinkDraft((prev) => ({ ...prev, [hypothesis.id]: { constructId: "", position: draft.position } }));
                    }}
                    disabled={busy || !draft.constructId}
                    className="rounded border border-neutral-300 px-2 py-1 text-[11px] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                  >
                    Link
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
