"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ItemMethodologyEditor from "@/components/ItemMethodologyEditor";
import type {
  QuestionnaireQuestionRow,
  ResearchConstructRow,
  ResearchIndicatorRow,
  ResearchInstrumentRow,
  ResearchScaleRow,
  ValidationStatus,
} from "@/lib/db/types";
import type { MappingProposal } from "@/lib/methodology/suggestions";

const VALIDATION_STYLE: Record<ValidationStatus, string> = {
  validated: "bg-green-100 text-green-700",
  adapted: "bg-amber-100 text-amber-700",
  researcher_developed: "bg-neutral-100 text-neutral-600",
};

const VALIDATION_LABEL: Record<ValidationStatus, string> = {
  validated: "Validated instrument",
  adapted: "Adapted instrument",
  researcher_developed: "Researcher-developed",
};

export default function QuestionnaireBuilder({ projectId }: { projectId: string }) {
  const [instruments, setInstruments] = useState<ResearchInstrumentRow[]>([]);
  const [selected, setSelected] = useState<{ instrument: ResearchInstrumentRow; questions: QuestionnaireQuestionRow[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Reused across a manual retry after a failed attempt (see the route's idempotency handling) so a retry can never create a second instrument — cleared only once a generation actually succeeds. */
  const pendingGenerateKeyRef = useRef<string | null>(null);

  /**
   * Phase 18 §22: the methodology model an item can be mapped to. Loaded once
   * an instrument is opened rather than with the instrument list — a researcher
   * browsing their questionnaires has no use for it yet.
   */
  const [constructs, setConstructs] = useState<ResearchConstructRow[]>([]);
  const [indicators, setIndicators] = useState<ResearchIndicatorRow[]>([]);
  const [scales, setScales] = useState<ResearchScaleRow[]>([]);
  const [mappingFor, setMappingFor] = useState<string | null>(null);
  const [mappingSuggestions, setMappingSuggestions] = useState<MappingProposal[] | null>(null);
  const [busy, setBusy] = useState(false);

  const methodologyBase = `/api/research/projects/${projectId}/methodology`;

  const loadMethodology = useCallback(async () => {
    try {
      const res = await fetch(methodologyBase);
      if (!res.ok) return;
      const { model } = await res.json();
      setConstructs(model.constructs ?? []);
      setIndicators(model.indicators ?? []);
      setScales(model.scales ?? []);
    } catch {
      // The questionnaire is still fully usable without the mapping options —
      // failing to load them must not take the builder down with it.
    }
  }, [methodologyBase]);

  async function loadInstruments() {
    setLoading(true);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/instruments`);
      if (res.ok) {
        const { instruments: list } = await res.json();
        setInstruments(list);
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadInstruments();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    const idempotencyKey = pendingGenerateKeyRef.current ?? crypto.randomUUID();
    pendingGenerateKeyRef.current = idempotencyKey;
    try {
      const res = await fetch(`/api/research/projects/${projectId}/instruments`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Generation failed");
      }
      const result = await res.json();
      setInstruments((prev) => [result.instrument, ...prev]);
      setSelected(result);
      pendingGenerateKeyRef.current = null; // succeeded — a future click starts a new logical attempt
    } catch (err) {
      setError((err as Error).message);
      // Key is intentionally kept: a retry after a failed attempt reuses
      // it, so the route can recognize a request that actually succeeded
      // server-side despite the client seeing a failure.
    } finally {
      setGenerating(false);
    }
  }

  async function updateItemMapping(itemId: string, patch: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`${methodologyBase}/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error("That change could not be saved.");
      const { item } = await res.json();
      setSelected((prev) =>
        prev ? { ...prev, questions: prev.questions.map((q) => (q.id === item.id ? item : q)) } : prev,
      );
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function suggestMapping(itemId: string) {
    setBusy(true);
    setMappingFor(itemId);
    try {
      const res = await fetch(`${methodologyBase}/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "item_mapping", itemId }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error ?? "That suggestion could not be produced.");
      setMappingSuggestions(payload.proposals ?? []);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
      setMappingSuggestions(null);
    } finally {
      setBusy(false);
    }
  }

  async function openInstrument(id: string) {
    void loadMethodology();
    const res = await fetch(`/api/research/projects/${projectId}/instruments/${id}`);
    if (res.ok) setSelected(await res.json());
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/research/projects/${projectId}/instruments/${id}`, { method: "DELETE" });
    if (res.ok) {
      setInstruments((prev) => prev.filter((i) => i.id !== id));
      if (selected?.instrument.id === id) setSelected(null);
    }
  }

  const questionsBySection = selected
    ? selected.questions.reduce<Record<string, QuestionnaireQuestionRow[]>>((acc, q) => {
        (acc[q.section_label] ??= []).push(q);
        return acc;
      }, {})
    : {};

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Questionnaire / Instrument</h2>
        <button
          type="button"
          onClick={handleGenerate}
          disabled={generating}
          className="rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
        >
          {generating ? "Generating…" : "Generate with AI"}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!selected && (
        <div className="space-y-2">
          {loading && <p className="text-sm text-neutral-400">Loading…</p>}
          {!loading && instruments.length === 0 && (
            <p className="rounded border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
              No instrument yet. Generate one from your project&apos;s objectives and variables, or come
              back once those sections have content.
            </p>
          )}
          {instruments.map((instrument) => (
            <div
              key={instrument.id}
              className="flex items-center justify-between rounded border border-neutral-200 p-3"
            >
              <button type="button" onClick={() => openInstrument(instrument.id)} className="text-left">
                <p className="text-sm font-medium">{instrument.name}</p>
                <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs ${VALIDATION_STYLE[instrument.validation_status]}`}>
                  {VALIDATION_LABEL[instrument.validation_status]}
                </span>
                {instrument.source_reference && (
                  <span className="ml-2 text-xs text-neutral-500">{instrument.source_reference}</span>
                )}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(instrument.id)}
                className="shrink-0 text-xs text-neutral-500 hover:text-red-600"
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}

      {selected && (
        <div>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="mb-3 text-xs text-neutral-500 hover:underline"
          >
            ← All instruments
          </button>

          <div className="mb-4">
            <h3 className="font-medium">{selected.instrument.name}</h3>
            <span
              className={`mt-1 inline-block rounded px-1.5 py-0.5 text-xs ${VALIDATION_STYLE[selected.instrument.validation_status]}`}
            >
              {VALIDATION_LABEL[selected.instrument.validation_status]}
            </span>
            {selected.instrument.source_reference && (
              <p className="mt-1 text-xs text-neutral-500">Source: {selected.instrument.source_reference}</p>
            )}
            {selected.instrument.adaptation_notes && (
              <p className="mt-1 text-xs text-neutral-500">{selected.instrument.adaptation_notes}</p>
            )}
          </div>

          {Object.entries(questionsBySection).map(([section, questions]) => (
            <div key={section} className="mb-4">
              <h4 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">
                {section}
              </h4>
              <ol className="space-y-2">
                {questions.map((q) => (
                  <li key={q.id} className="rounded border border-neutral-200 p-2 text-sm">
                    <p>{q.question_text}</p>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-neutral-500">
                      <span>{q.response_type}</span>
                      {q.required && <span>· required</span>}
                      {q.objective_label && <span>· objective: {q.objective_label}</span>}
                      {q.variable_label && <span>· variable: {q.variable_label}</span>}
                      {q.construct && <span>· construct: {q.construct}</span>}
                    </div>
                    {q.options && q.options.length > 0 && (
                      <p className="mt-1 text-xs text-neutral-400">Options: {q.options.join(", ")}</p>
                    )}
                    <ItemMethodologyEditor
                      item={q}
                      constructs={constructs}
                      indicators={indicators}
                      scales={scales}
                      busy={busy}
                      onChange={(patch) => updateItemMapping(q.id, patch)}
                      onSuggestMapping={suggestMapping}
                      suggestions={mappingFor === q.id ? mappingSuggestions : null}
                      onAcceptSuggestion={async (proposal) => {
                        await updateItemMapping(q.id, {
                          constructId: proposal.constructId,
                          indicatorId: proposal.indicatorId,
                        });
                        setMappingSuggestions(null);
                        await fetch(`${methodologyBase}/decisions`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            entityType: "questionnaire_item",
                            entityId: q.id,
                            accepted: true,
                            summary: "Accepted a suggested item mapping",
                            proposal,
                          }),
                        }).catch(() => undefined);
                      }}
                      onRejectSuggestion={async (proposal) => {
                        setMappingSuggestions((prev) => (prev ?? []).filter((p) => p !== proposal));
                        await fetch(`${methodologyBase}/decisions`, {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            entityType: "questionnaire_item",
                            entityId: q.id,
                            accepted: false,
                            summary: "Rejected a suggested item mapping",
                            proposal,
                          }),
                        }).catch(() => undefined);
                      }}
                    />
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
