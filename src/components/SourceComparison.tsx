"use client";

import { useState } from "react";
import { NOT_AVAILABLE, type SourceComparison as ComparisonData } from "@/lib/evidence/comparison";
import { MAX_COMPARE_SOURCES, MIN_COMPARE_SOURCES } from "@/lib/evidence/comparison";
import type { ResearchCitationRow } from "@/lib/db/types";

/**
 * Field-by-field comparison of 2-5 sources (§20-§21).
 *
 * Two things are deliberate and load-bearing.
 *
 * A cell the source does not state reads "Not available in source" in a
 * different colour from real content — not blank, and never filled in. A
 * reader scanning the table has to be able to tell what was read from what was
 * missing, or the table is worse than no table.
 *
 * Agreements and disagreements list the citation keys they are about. §21
 * rules out an unattributed merged narrative, so a statement whose sources
 * cannot be resolved is dropped server-side rather than shown without them.
 */
export default function SourceComparison({
  projectId,
  citations,
  selectedIds,
  onSelectionChange,
}: {
  projectId: string;
  citations: ResearchCitationRow[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}) {
  const [comparison, setComparison] = useState<ComparisonData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCompare = selectedIds.length >= MIN_COMPARE_SOURCES && selectedIds.length <= MAX_COMPARE_SOURCES;

  async function compare(extractMissing: boolean) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/literature/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ citationIds: selectedIds, extractMissing, withNotes: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "The comparison could not be built.");
      setComparison(body.comparison);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const keyById = new Map(citations.map((c) => [c.id, c.citation_key]));

  return (
    <div className="space-y-3 text-xs">
      <fieldset>
        <legend className="text-[11px] font-medium text-neutral-500">
          Choose {MIN_COMPARE_SOURCES}–{MAX_COMPARE_SOURCES} sources
        </legend>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {citations.map((citation) => {
            const checked = selectedIds.includes(citation.id);
            return (
              <label
                key={citation.id}
                className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-1 ${
                  checked ? "border-neutral-900 bg-neutral-100" : "border-neutral-300"
                }`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() =>
                    onSelectionChange(
                      checked
                        ? selectedIds.filter((id) => id !== citation.id)
                        : [...selectedIds, citation.id],
                    )
                  }
                  className="h-3 w-3"
                />
                {citation.citation_key}
              </label>
            );
          })}
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!canCompare || busy}
          onClick={() => compare(false)}
          className="rounded bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          {busy ? "Comparing…" : "Compare"}
        </button>
        <button
          type="button"
          disabled={!canCompare || busy}
          onClick={() => compare(true)}
          className="rounded border border-neutral-300 px-3 py-1.5 text-xs disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
        >
          Compare and read missing sources
        </button>
      </div>

      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-red-800">
          {error}
        </p>
      )}

      {!comparison && !busy && (
        <p className="rounded border border-neutral-200 p-4 text-center text-neutral-600">
          Select sources above to compare them field by field.
        </p>
      )}

      {comparison && (
        <>
          {comparison.unprofiledCitationIds.length > 0 && (
            <p className="rounded border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-900">
              {comparison.unprofiledCitationIds.length} of these sources have not been read yet, so their columns are
              empty. Use “Compare and read missing sources” to extract them.
            </p>
          )}

          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left">
              <caption className="sr-only">Source comparison</caption>
              <thead>
                <tr>
                  <th scope="col" className="border-b border-neutral-300 p-2 text-[11px] font-medium text-neutral-500">
                    Field
                  </th>
                  {comparison.columns.map((col) => (
                    <th
                      key={col.citationId}
                      scope="col"
                      className="border-b border-neutral-300 p-2 align-bottom text-[11px] font-medium"
                    >
                      <span className="block font-mono text-neutral-900">[{col.citationKey}]</span>
                      <span className="block font-normal text-neutral-500">
                        {col.title ?? "Untitled"}
                        {col.year ? ` (${col.year})` : ""}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.fields.map((field, rowIndex) => (
                  <tr key={field.field} className={rowIndex % 2 ? "bg-neutral-50" : ""}>
                    <th scope="row" className="p-2 align-top text-[11px] font-medium text-neutral-700">
                      {field.label}
                    </th>
                    {comparison.columns.map((col) => {
                      const cell = col.cells.find((c) => c.field === field.field);
                      return (
                        <td key={col.citationId} className="p-2 align-top leading-relaxed">
                          {cell?.value ? (
                            <>
                              <span className="text-neutral-800">{cell.value}</span>
                              {cell.provenance === "ai_inference" && (
                                <span className="mt-0.5 block text-[10px] font-semibold text-amber-700">
                                  AI INFERENCE
                                </span>
                              )}
                            </>
                          ) : (
                            <span className="italic text-neutral-400">{NOT_AVAILABLE}</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <section aria-labelledby="agreement-heading">
            <h4 id="agreement-heading" className="mb-1 text-xs font-medium">
              Agreement
            </h4>
            {comparison.agreements.length === 0 ? (
              <p className="text-[11px] text-neutral-500">Nothing the selected sources clearly agree on.</p>
            ) : (
              <ul className="space-y-1">
                {comparison.agreements.map((s, i) => (
                  <li key={i} className="rounded border border-neutral-200 p-2">
                    <p>{s.text}</p>
                    <p className="mt-1 font-mono text-[11px] text-neutral-500">
                      {s.citationIds.map((id) => `[${keyById.get(id) ?? "?"}]`).join(" ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="disagreement-heading">
            <h4 id="disagreement-heading" className="mb-1 text-xs font-medium">
              Disagreement
            </h4>
            {comparison.disagreements.length === 0 ? (
              <p className="text-[11px] text-neutral-500">No direct disagreement found between these sources.</p>
            ) : (
              <ul className="space-y-1">
                {comparison.disagreements.map((s, i) => (
                  <li key={i} className="rounded border border-amber-300 bg-amber-50 p-2">
                    <p>{s.text}</p>
                    <p className="mt-1 font-mono text-[11px] text-amber-800">
                      {s.citationIds.map((id) => `[${keyById.get(id) ?? "?"}]`).join(" ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
