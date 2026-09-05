"use client";

import { useCallback, useEffect, useState } from "react";
import { useDialogOverlay } from "@/lib/ui/use-dialog-overlay";
import ConstructPanel from "@/components/ConstructPanel";
import CoverageMatrixView from "@/components/CoverageMatrixView";
import HypothesisPanel from "@/components/HypothesisPanel";
import MethodologyFindings from "@/components/MethodologyFindings";
import MethodologyMetrics from "@/components/MethodologyMetrics";
import QuestionObjectivePanel from "@/components/QuestionObjectivePanel";
import { buildCoverageMatrix } from "@/lib/methodology/coverage";
import type { MethodologyModel } from "@/lib/methodology/model";
import type { MethodologyFinding, MethodologyReview } from "@/lib/methodology/types";
import type {
  ConstructRole,
  HypothesisForm,
  HypothesisPosition,
  MethodologyEntityType,
} from "@/lib/db/types";
import type { ConstructProposal, HypothesisProposal, RewriteProposal } from "@/lib/methodology/suggestions";

/**
 * The methodology workspace (§19).
 *
 * Same shape as the literature workspace, deliberately: a full-screen overlay
 * over the editor rather than a route, so closing it returns the researcher to
 * the paragraph they left with the editor never having unmounted. Reusing that
 * pattern also means there is one workspace idiom in the app rather than two.
 *
 * The overview is the entry point because it is the only view that answers
 * "where should I look" — every tile and every finding leads to the tab that
 * holds the thing it is about (§20).
 */
export type MethodologyTab = "overview" | "questions" | "constructs" | "hypotheses" | "coverage";

const TABS: { id: MethodologyTab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "questions", label: "Questions" },
  { id: "constructs", label: "Constructs" },
  { id: "hypotheses", label: "Hypotheses" },
  { id: "coverage", label: "Coverage" },
];

/** Where a finding about this kind of object lives. */
const TAB_FOR_TARGET: Record<string, MethodologyTab> = {
  research_question: "questions",
  objective: "questions",
  construct: "constructs",
  indicator: "constructs",
  hypothesis: "hypotheses",
  questionnaire_item: "coverage",
  scale: "coverage",
  analysis_plan: "hypotheses",
  project: "overview",
};

const METRIC_TAB: Record<string, MethodologyTab> = {
  question_alignment: "questions",
  objective_coverage: "questions",
  construct_completeness: "constructs",
  variable_traceability: "constructs",
  hypothesis_traceability: "hypotheses",
  measurement_coverage: "coverage",
  questionnaire_coverage: "coverage",
  analysis_coverage: "hypotheses",
  provenance_integrity: "coverage",
};

export default function MethodologyWorkspace({
  projectId,
  initialTab = "overview",
  onClose,
}: {
  projectId: string;
  initialTab?: MethodologyTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<MethodologyTab>(initialTab);
  const [model, setModel] = useState<MethodologyModel | null>(null);
  const [review, setReview] = useState<MethodologyReview | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [constructSuggestions, setConstructSuggestions] = useState<ConstructProposal[] | null>(null);
  const [suggestionsForQuestion, setSuggestionsForQuestion] = useState<string | null>(null);
  const [definitionSuggestions, setDefinitionSuggestions] = useState<RewriteProposal[] | null>(null);
  const [suggestionsForConstruct, setSuggestionsForConstruct] = useState<string | null>(null);
  const [hypothesisSuggestions, setHypothesisSuggestions] = useState<HypothesisProposal[] | null>(null);
  const [truncationNotice, setTruncationNotice] = useState<string | null>(null);

  const base = `/api/research/projects/${projectId}/methodology`;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The model and the review together: the review is derived from the same
      // rows, and fetching them separately would render a coverage number
      // beside a construct list that disagreed with it.
      const [modelRes, reviewRes] = await Promise.all([fetch(base), fetch(`${base}/review`)]);
      if (!modelRes.ok || !reviewRes.ok) throw new Error("Your methodology could not be loaded.");
      setModel((await modelRes.json()).model);
      setReview((await reviewRes.json()).review);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  async function mutate(path: string, init: RequestInit, failure: string) {
    setBusy(true);
    try {
      const res = await fetch(`${base}${path}`, {
        headers: { "Content-Type": "application/json" },
        ...init,
      });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error as string) ?? failure);
      await load();
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function suggest(body: unknown): Promise<{ proposals: unknown[]; contextTruncated: boolean; notes: string[] } | null> {
    setBusy(true);
    try {
      const res = await fetch(`${base}/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((payload.error as string) ?? "That suggestion could not be produced.");
      // §18: a truncated context is surfaced, never swallowed. A researcher
      // reading a proposal deserves to know it was made from a fragment.
      setTruncationNotice(
        payload.contextTruncated
          ? "This suggestion was made from a shortened version of your text — check it against the full wording."
          : null,
      );
      setError(null);
      return payload;
    } catch (err) {
      setError((err as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }

  /** Records what the researcher did with a proposal, accepted or not (§23). */
  async function recordDecision(
    entityType: MethodologyEntityType,
    accepted: boolean,
    summary: string,
    proposal: unknown,
    entityId?: string,
  ) {
    await fetch(`${base}/decisions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entityType, accepted, summary, proposal, entityId: entityId ?? null }),
    }).catch(() => undefined);
  }

  const coverage = model ? buildCoverageMatrix(model) : null;

  function goToFinding(finding: MethodologyFinding) {
    setTab(TAB_FOR_TARGET[finding.targetType] ?? "overview");
  }

  // §33: dialog semantics — focus moves in, is trapped, and returns to
  // whatever opened this when it closes. Escape closes.
  const overlayRef = useDialogOverlay(onClose);

  return (
    <div
      ref={overlayRef}
      role="dialog"
      aria-modal="true"
      aria-label="Methodology"
      className="fixed inset-0 z-30 flex flex-col bg-white"
    >
      <header className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <div>
          <h2 className="font-medium">Methodology</h2>
          <p className="text-[11px] text-neutral-500">
            What is consistent, what is missing, and what conflicts — checked against what you have stored.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900"
        >
          Close
        </button>
      </header>

      <div role="tablist" aria-label="Methodology workspace" className="flex overflow-x-auto border-b border-neutral-200">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`meth-tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`meth-panel-${t.id}`}
            tabIndex={tab === t.id ? 0 : -1}
            onClick={() => setTab(t.id)}
            onKeyDown={(e) => {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              const i = TABS.findIndex((x) => x.id === tab);
              const next = e.key === "ArrowRight" ? (i + 1) % TABS.length : (i - 1 + TABS.length) % TABS.length;
              setTab(TABS[next].id);
              document.getElementById(`meth-tab-${TABS[next].id}`)?.focus();
            }}
            className={`shrink-0 px-4 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-neutral-900 ${
              tab === t.id ? "border-b-2 border-neutral-900 font-medium" : "text-neutral-500"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {error && (
          <p role="alert" className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-xs text-red-800">
            {error}
          </p>
        )}

        {truncationNotice && (
          <p className="mb-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            {truncationNotice}
          </p>
        )}

        {loading && (
          <p role="status" aria-live="polite" className="text-xs text-neutral-500">
            Loading your methodology…
          </p>
        )}

        {!loading && model && review && (
          <>
            <div role="tabpanel" id="meth-panel-overview" aria-labelledby="meth-tab-overview" hidden={tab !== "overview"}>
              <MethodologyMetrics
                metrics={review.metrics}
                onSelect={(metric) => setTab(METRIC_TAB[metric.id] ?? "overview")}
              />
              <h3 className="mt-4 mb-2 text-sm font-medium">Consistency review</h3>
              <MethodologyFindings findings={review.findings} onNavigate={goToFinding} />
            </div>

            <div role="tabpanel" id="meth-panel-questions" aria-labelledby="meth-tab-questions" hidden={tab !== "questions"}>
              <QuestionObjectivePanel
                questions={model.questions}
                objectives={model.objectives}
                busy={busy}
                onAddQuestion={(text) =>
                  mutate("/questions", { method: "POST", body: JSON.stringify({ questionText: text }) }, "That question could not be saved.")
                }
                onAddObjective={(text, questionId) =>
                  mutate(
                    "/objectives",
                    { method: "POST", body: JSON.stringify({ objectiveText: text, questionId }) },
                    "That objective could not be saved.",
                  )
                }
                onDeleteQuestion={(id) =>
                  mutate(`/questions/${id}`, { method: "DELETE" }, "That question could not be deleted.")
                }
                onSuggestConstructs={async (questionId) => {
                  setSuggestionsForQuestion(questionId);
                  const result = await suggest({ kind: "constructs", questionId });
                  setConstructSuggestions((result?.proposals as ConstructProposal[]) ?? []);
                }}
                suggestions={constructSuggestions}
                suggestionsFor={suggestionsForQuestion}
                onAcceptConstruct={async (proposal, name) => {
                  await mutate(
                    "/constructs",
                    {
                      method: "POST",
                      body: JSON.stringify({
                        name,
                        role: proposal.role,
                        conceptualDefinition: proposal.conceptualDefinition,
                        // Provenance survives the accept: this construct came
                        // from a suggestion, and the history should say so even
                        // after the researcher renames it.
                        provenance: "ai_suggested",
                      }),
                    },
                    "That construct could not be saved.",
                  );
                  await recordDecision("construct", true, `Accepted suggested construct: ${name}`, proposal);
                }}
                onRejectConstruct={async (proposal) => {
                  setConstructSuggestions((prev) => (prev ?? []).filter((p) => p !== proposal));
                  await recordDecision("construct", false, `Rejected suggested construct: ${proposal.name}`, proposal);
                }}
              />
            </div>

            <div role="tabpanel" id="meth-panel-constructs" aria-labelledby="meth-tab-constructs" hidden={tab !== "constructs"}>
              <ConstructPanel
                projectId={projectId}
                constructs={model.constructs}
                indicators={model.indicators}
                busy={busy}
                onAdd={(name, role: ConstructRole) =>
                  mutate("/constructs", { method: "POST", body: JSON.stringify({ name, role }) }, "That construct could not be saved.")
                }
                onUpdate={(constructId, patch) =>
                  mutate(`/constructs/${constructId}`, { method: "PATCH", body: JSON.stringify(patch) }, "That change could not be saved.")
                }
                onDelete={(constructId) =>
                  mutate(`/constructs/${constructId}`, { method: "DELETE" }, "That construct could not be deleted.")
                }
                onAddIndicator={(constructId, name, dimension) =>
                  mutate(
                    "/indicators",
                    { method: "POST", body: JSON.stringify({ constructId, name, dimension }) },
                    "That indicator could not be saved.",
                  )
                }
                onSuggestDefinition={async (constructId) => {
                  setSuggestionsForConstruct(constructId);
                  const result = await suggest({ kind: "operational_definition", constructId });
                  setDefinitionSuggestions((result?.proposals as RewriteProposal[]) ?? []);
                }}
                definitionSuggestions={definitionSuggestions}
                suggestionsFor={suggestionsForConstruct}
                onAcceptDefinition={async (constructId, text) => {
                  await mutate(
                    `/constructs/${constructId}`,
                    { method: "PATCH", body: JSON.stringify({ operationalDefinition: text }) },
                    "That definition could not be saved.",
                  );
                  await recordDecision("construct", true, "Accepted a suggested operational definition", { text }, constructId);
                  setDefinitionSuggestions(null);
                }}
                onRejectDefinition={async (proposal) => {
                  setDefinitionSuggestions((prev) => (prev ?? []).filter((p) => p !== proposal));
                  await recordDecision("construct", false, "Rejected a suggested operational definition", proposal);
                }}
              />
            </div>

            <div role="tabpanel" id="meth-panel-hypotheses" aria-labelledby="meth-tab-hypotheses" hidden={tab !== "hypotheses"}>
              <HypothesisPanel
                hypotheses={model.hypotheses}
                links={model.hypothesisVariables}
                constructs={model.constructs}
                objectives={model.objectives}
                busy={busy}
                onAdd={(input) =>
                  mutate(
                    "/hypotheses",
                    {
                      method: "POST",
                      body: JSON.stringify({
                        statement: input.statement,
                        label: input.label,
                        hypothesisForm: input.form as HypothesisForm,
                        objectiveId: input.objectiveId,
                      }),
                    },
                    "That hypothesis could not be saved.",
                  )
                }
                onDelete={(id) => mutate(`/hypotheses/${id}`, { method: "DELETE" }, "That hypothesis could not be deleted.")}
                onLink={(hypothesisId, constructId, position: HypothesisPosition) =>
                  mutate(
                    `/hypotheses/${hypothesisId}/variables`,
                    { method: "POST", body: JSON.stringify({ constructId, position }) },
                    "That construct could not be linked.",
                  )
                }
                onUnlink={(hypothesisId, linkId) =>
                  mutate(
                    `/hypotheses/${hypothesisId}/variables/${linkId}`,
                    { method: "DELETE" },
                    "That link could not be removed.",
                  )
                }
                onSuggest={async () => {
                  const questionId = model.questions[0]?.id;
                  if (!questionId) {
                    setError("Add a research question first — hypotheses are suggested from one.");
                    return;
                  }
                  const result = await suggest({ kind: "hypotheses", questionId });
                  setHypothesisSuggestions((result?.proposals as HypothesisProposal[]) ?? []);
                }}
                suggestions={hypothesisSuggestions}
                onAcceptSuggestion={async (proposal, statement) => {
                  await mutate(
                    "/hypotheses",
                    {
                      method: "POST",
                      body: JSON.stringify({
                        statement,
                        hypothesisForm: proposal.form,
                        provenance: "ai_suggested",
                      }),
                    },
                    "That hypothesis could not be saved.",
                  );
                  await recordDecision("hypothesis", true, `Accepted suggested hypothesis: ${statement.slice(0, 100)}`, proposal);
                }}
                onRejectSuggestion={async (proposal) => {
                  setHypothesisSuggestions((prev) => (prev ?? []).filter((p) => p !== proposal));
                  await recordDecision("hypothesis", false, "Rejected a suggested hypothesis", proposal);
                }}
              />
            </div>

            <div role="tabpanel" id="meth-panel-coverage" aria-labelledby="meth-tab-coverage" hidden={tab !== "coverage"}>
              {coverage && <CoverageMatrixView matrix={coverage} />}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
