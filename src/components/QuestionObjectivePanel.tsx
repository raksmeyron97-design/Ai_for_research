"use client";

import { useState } from "react";
import AISuggestionCard from "@/components/AISuggestionCard";
import { QUESTION_KIND_LABELS } from "@/lib/db/types";
import type { ResearchObjectiveRow, ResearchQuestionRow } from "@/lib/db/types";
import type { ConstructProposal } from "@/lib/methodology/suggestions";

/**
 * Research questions and the objectives under them (§6, §19).
 *
 * They share a panel because the relationship is the point: an objective's
 * whole job is to say what will be done about a question, and a screen that
 * lists them apart makes the one thing worth checking — which questions have
 * nothing under them — the thing you have to hold in your head.
 */
export default function QuestionObjectivePanel({
  questions,
  objectives,
  busy,
  onAddQuestion,
  onAddObjective,
  onDeleteQuestion,
  onSuggestConstructs,
  onAcceptConstruct,
  onRejectConstruct,
  suggestions,
  suggestionsFor,
}: {
  questions: ResearchQuestionRow[];
  objectives: ResearchObjectiveRow[];
  busy?: boolean;
  onAddQuestion: (text: string) => void | Promise<void>;
  onAddObjective: (text: string, questionId: string | null) => void | Promise<void>;
  onDeleteQuestion: (questionId: string) => void | Promise<void>;
  onSuggestConstructs?: (questionId: string) => void | Promise<void>;
  onAcceptConstruct?: (proposal: ConstructProposal, name: string) => void | Promise<void>;
  onRejectConstruct?: (proposal: ConstructProposal) => void | Promise<void>;
  suggestions?: ConstructProposal[] | null;
  /** Which question the visible suggestions belong to. */
  suggestionsFor?: string | null;
}) {
  const [newQuestion, setNewQuestion] = useState("");
  const [newObjective, setNewObjective] = useState("");
  const [objectiveFor, setObjectiveFor] = useState<string>("");
  const [edited, setEdited] = useState<Record<string, string>>({});

  return (
    <div className="space-y-4">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!newQuestion.trim()) return;
          void onAddQuestion(newQuestion.trim());
          setNewQuestion("");
        }}
        className="flex flex-wrap gap-2"
      >
        <label htmlFor="new-question" className="sr-only">
          New research question
        </label>
        <input
          id="new-question"
          value={newQuestion}
          onChange={(e) => setNewQuestion(e.target.value)}
          placeholder="Add a research question"
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-xs focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !newQuestion.trim()}
          className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Add question
        </button>
      </form>

      {questions.length === 0 ? (
        <p className="rounded border border-neutral-200 p-4 text-center text-xs text-neutral-600">
          No research questions yet. Everything else in the methodology traces back to these, so this is the
          place to start.
        </p>
      ) : (
        <ul className="space-y-2">
          {questions.map((question) => {
            const under = objectives.filter((o) => o.question_id === question.id);
            return (
              <li key={question.id} className="rounded border border-neutral-200 p-2.5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-xs font-medium">{question.question_text}</p>
                    <p className="mt-0.5 text-[11px] text-neutral-500">
                      {QUESTION_KIND_LABELS[question.question_kind]}
                      {question.provenance === "ai_suggested" ? " · AI suggested" : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {onSuggestConstructs && (
                      <button
                        type="button"
                        onClick={() => void onSuggestConstructs(question.id)}
                        disabled={busy}
                        className="rounded border border-neutral-300 px-2 py-1 text-[11px] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                      >
                        Suggest constructs
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => void onDeleteQuestion(question.id)}
                      disabled={busy}
                      className="rounded border border-neutral-300 px-2 py-1 text-[11px] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                {under.length === 0 ? (
                  <p className="mt-2 text-[11px] text-amber-800">No objective yet for this question.</p>
                ) : (
                  <ul className="mt-2 space-y-1">
                    {under.map((objective) => (
                      <li key={objective.id} className="rounded bg-neutral-50 px-2 py-1 text-[11px]">
                        {objective.objective_text}
                      </li>
                    ))}
                  </ul>
                )}

                {suggestionsFor === question.id && suggestions && (
                  <ul className="mt-2 space-y-1.5">
                    {suggestions.length === 0 ? (
                      <li className="text-[11px] text-neutral-500">
                        No construct suggestions came back for this question.
                      </li>
                    ) : (
                      suggestions.map((proposal, i) => (
                        <AISuggestionCard
                          key={`${proposal.name}-${i}`}
                          title={proposal.name}
                          rationale={proposal.rationale}
                          editableText={edited[proposal.name] ?? proposal.name}
                          onEditableTextChange={(text) =>
                            setEdited((prev) => ({ ...prev, [proposal.name]: text }))
                          }
                          meta={proposal.conceptualDefinition}
                          busy={busy}
                          disabledReason={
                            proposal.alreadyExists
                              ? "A construct with this name already exists in the project."
                              : undefined
                          }
                          acceptLabel="Add construct"
                          onAccept={() =>
                            void onAcceptConstruct?.(proposal, edited[proposal.name] ?? proposal.name)
                          }
                          onReject={() => void onRejectConstruct?.(proposal)}
                        />
                      ))
                    )}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!newObjective.trim()) return;
          void onAddObjective(newObjective.trim(), objectiveFor || null);
          setNewObjective("");
        }}
        className="flex flex-wrap gap-2 border-t border-neutral-200 pt-3"
      >
        <label htmlFor="new-objective" className="sr-only">
          New objective
        </label>
        <input
          id="new-objective"
          value={newObjective}
          onChange={(e) => setNewObjective(e.target.value)}
          placeholder="Add an objective"
          className="min-w-0 flex-1 rounded border border-neutral-300 px-2 py-1.5 text-xs focus:border-neutral-500 focus:outline-none"
        />
        <label htmlFor="objective-question" className="sr-only">
          Research question this objective serves
        </label>
        <select
          id="objective-question"
          value={objectiveFor}
          onChange={(e) => setObjectiveFor(e.target.value)}
          className="rounded border border-neutral-300 px-2 py-1.5 text-xs"
        >
          <option value="">No question yet</option>
          {questions.map((q) => (
            <option key={q.id} value={q.id}>
              {q.question_text.slice(0, 60)}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy || !newObjective.trim()}
          className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Add objective
        </button>
      </form>
    </div>
  );
}
