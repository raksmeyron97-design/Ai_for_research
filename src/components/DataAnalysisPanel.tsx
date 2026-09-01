"use client";

import { useEffect, useState } from "react";
import type { ColumnSchema } from "@/lib/db/types";

interface DatasetMeta {
  id: string;
  file_name: string;
  row_count: number;
  column_schema: ColumnSchema[];
  created_at: string;
}

interface NumericSummary {
  type: "numeric";
  count: number;
  missing: number;
  mean: number;
  median: number;
  sd: number;
  min: number;
  max: number;
}
interface CategoricalSummary {
  type: "categorical";
  count: number;
  missing: number;
  frequencies: { value: string; count: number; percent: number }[];
}
interface OtherSummary {
  type: "text" | "date";
  count: number;
  missing: number;
  uniqueCount: number;
}
type ColumnSummary = NumericSummary | CategoricalSummary | OtherSummary;

export default function DataAnalysisPanel({ projectId }: { projectId: string }) {
  const [datasets, setDatasets] = useState<DatasetMeta[]>([]);
  const [selected, setSelected] = useState<{ dataset: DatasetMeta; summary: Record<string, ColumnSummary> } | null>(null);
  const [interpretation, setInterpretation] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadDatasets() {
    setLoading(true);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/datasets`);
      if (res.ok) setDatasets((await res.json()).datasets);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadDatasets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    setUploading(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch(`/api/research/projects/${projectId}/datasets`, { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Upload failed");
      }
      form.reset();
      await loadDatasets();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function openDataset(id: string) {
    setInterpretation(null);
    setError(null);
    const res = await fetch(`/api/research/projects/${projectId}/datasets/${id}`);
    if (res.ok) setSelected(await res.json());
  }

  async function handleDelete(id: string) {
    const res = await fetch(`/api/research/projects/${projectId}/datasets/${id}`, { method: "DELETE" });
    if (res.ok) {
      setDatasets((prev) => prev.filter((d) => d.id !== id));
      if (selected?.dataset.id === id) setSelected(null);
    }
  }

  async function handleAnalyze() {
    if (!selected) return;
    setAnalyzing(true);
    setError(null);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/datasets/${selected.dataset.id}/analyze`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? "Analysis failed");
      }
      const result = await res.json();
      setInterpretation(result.interpretation);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Data Analysis</h2>
      </div>

      {!selected && (
        <>
          <form onSubmit={handleUpload} className="flex flex-col gap-2 border-b border-neutral-200 pb-4">
            <input type="file" name="file" accept=".csv,.xlsx" required className="text-sm" />
            <button
              type="submit"
              disabled={uploading}
              className="w-fit rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {uploading ? "Uploading & parsing…" : "Upload dataset (CSV/XLSX)"}
            </button>
          </form>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="space-y-2">
            {loading && <p className="text-sm text-neutral-400">Loading…</p>}
            {!loading && datasets.length === 0 && (
              <p className="rounded border border-dashed border-neutral-300 p-6 text-center text-sm text-neutral-500">
                No dataset uploaded yet. Real results can only be generated once real data exists here.
              </p>
            )}
            {datasets.map((d) => (
              <div key={d.id} className="flex items-center justify-between rounded border border-neutral-200 p-3">
                <button type="button" onClick={() => openDataset(d.id)} className="text-left">
                  <p className="text-sm font-medium">{d.file_name}</p>
                  <p className="text-xs text-neutral-500">
                    {d.row_count} rows · {d.column_schema.length} columns
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(d.id)}
                  className="shrink-0 text-xs text-neutral-500 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        </>
      )}

      {selected && (
        <div>
          <button
            type="button"
            onClick={() => {
              setSelected(null);
              setError(null);
            }}
            className="mb-3 text-xs text-neutral-500 hover:underline"
          >
            ← All datasets
          </button>

          <h3 className="mb-1 font-medium">{selected.dataset.file_name}</h3>
          <p className="mb-3 text-xs text-neutral-500">{selected.dataset.row_count} rows</p>

          <div className="space-y-2">
            {Object.entries(selected.summary).map(([column, stat]) => (
              <div key={column} className="rounded border border-neutral-200 p-2 text-sm">
                <p className="font-medium">
                  {column} <span className="font-normal text-neutral-400">({stat.type})</span>
                </p>
                <p className="text-xs text-neutral-500">
                  n={stat.count}, missing={stat.missing}
                </p>
                {stat.type === "numeric" && (
                  <p className="mt-1 text-xs">
                    mean={round(stat.mean)} · median={round(stat.median)} · SD={round(stat.sd)} · min={stat.min} · max={stat.max}
                  </p>
                )}
                {stat.type === "categorical" && (
                  <p className="mt-1 text-xs">
                    {stat.frequencies.map((f) => `${f.value}: ${f.count} (${f.percent}%)`).join(", ")}
                  </p>
                )}
                {(stat.type === "text" || stat.type === "date") && (
                  <p className="mt-1 text-xs">unique values: {stat.uniqueCount}</p>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={handleAnalyze}
            disabled={analyzing}
            className="mt-4 rounded bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
          >
            {analyzing ? "Generating interpretation…" : "Generate AI interpretation"}
          </button>
          {error && <p className="mt-2 text-sm text-red-600">{error}</p>}

          {interpretation && (
            <div className="mt-4 rounded border border-neutral-200 bg-neutral-50 p-3 text-sm">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
                AI Interpretation (grounded only in the numbers above)
              </p>
              <p className="whitespace-pre-wrap">{interpretation}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
