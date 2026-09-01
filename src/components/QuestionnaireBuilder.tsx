"use client";

import { useEffect, useState } from "react";
import type {
  QuestionnaireQuestionRow,
  ResearchInstrumentRow,
  ValidationStatus,
} from "@/lib/db/types";

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
    try {
      const res = await fetch(`/api/research/projects/${projectId}/instruments`, { method: "POST" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Generation failed");
      }
      const result = await res.json();
      setInstruments((prev) => [result.instrument, ...prev]);
      setSelected(result);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function openInstrument(id: string) {
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
