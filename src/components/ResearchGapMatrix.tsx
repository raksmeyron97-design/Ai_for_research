"use client";

import { useEffect, useState } from "react";
import {
  GAP_BASIS_LABELS,
  type GapBasis,
  type ResearchCitationRow,
  type ResearchGapRow,
  type ResearchSourceProfileRow,
} from "@/lib/db/types";
import type { GapSuggestion } from "@/lib/evidence/gap-analysis";

/**
 * The research gap matrix (§23-§24).
 *
 * Study · Population · Design · Finding · Limitation · Gap, with the basis of
 * every gap shown beside it. That column is the reason the table exists rather
 * than a list: a gap a paper states in its own future-work paragraph and a gap
 * a model worked out from a small sample are both useful and are not the same
 * claim, and a matrix that renders them identically turns the second into the
 * first.
 *
 * A suggestion whose claimed basis did not survive checking says so
 * explicitly. Downgrading silently would be the same failure one layer down.
 */
const BASIS_STYLE: Record<GapBasis, string> = {
  source_stated: "bg-green-100 text-green-800",
  derived_limitation: "bg-blue-100 text-blue-800",
  ai_inference: "bg-amber-100 text-amber-800",
  user_observation: "bg-neutral-200 text-neutral-700",
  needs_verification: "bg-red-100 text-red-800",
};

export default function ResearchGapMatrix({
  projectId,
  citations,
  profiles,
  selectedIds,
  onSelectionChange,
}: {
  projectId: string;
  citations: ResearchCitationRow[];
  /** Already-extracted source facts; the matrix shows what is known, not what it guesses. */
  profiles: ResearchSourceProfileRow[];
  selectedIds: string[];
  onSelectionChange: (ids: string[]) => void;
}) {
  const [gaps, setGaps] = useState<ResearchGapRow[]>([]);
  const [suggestions, setSuggestions] = useState<GapSuggestion[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const res = await fetch(`/api/research/projects/${projectId}/gaps`);
      if (!res.ok) return;
      const body = await res.json();
      setGaps(body.gaps ?? []);
    } catch {
      // The matrix still renders the study rows without saved gaps.
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  async function suggest() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/gaps/suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ citationIds: selectedIds }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Gap suggestions could not be generated.");
      setSuggestions(body.suggestions ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function accept(suggestion: GapSuggestion, index: number) {
    setBusy(true);
    try {
      const res = await fetch(`/api/research/projects/${projectId}/gaps`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gaps: [
            {
              text: suggestion.gap_text,
              citationId: suggestion.citation_id ?? null,
              basis: suggestion.basis,
              supportingText: suggestion.supporting_text ?? null,
            },
          ],
        }),
      });
      if (res.ok) {
        setSuggestions((prev) => (prev ?? []).filter((_, i) => i !== index));
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function toggleVerified(gap: ResearchGapRow) {
    setBusy(true);
    try {
      await fetch(`/api/research/projects/${projectId}/gaps/${gap.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ verified: !gap.verified }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  const selected = citations.filter((c) => selectedIds.includes(c.id));
  const profileFor = (citationId: string) => profiles.find((p) => p.citation_id === citationId);
  const gapsFor = (citationId: string) => gaps.filter((g) => g.citation_id === citationId);
  const unattributed = gaps.filter((g) => !g.citation_id);

  return (
    <div className="space-y-3 text-xs">
      <fieldset>
        <legend className="text-[11px] font-medium text-neutral-500">Studies to include</legend>
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
                      checked ? selectedIds.filter((id) => id !== citation.id) : [...selectedIds, citation.id],
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

      <button
        type="button"
        disabled={busy || selectedIds.length === 0}
        onClick={suggest}
        className="rounded border border-neutral-300 px-3 py-1.5 text-xs disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2"
      >
        {busy ? "Working…" : "Suggest gaps"}
      </button>

      {error && (
        <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-red-800">
          {error}
        </p>
      )}

      {selected.length === 0 ? (
        <div className="rounded border border-neutral-200 p-4 text-center">
          <p className="mb-1 text-neutral-600">Add studies to compare research gaps.</p>
          <p className="text-[11px] text-neutral-500">Select sources above to build the matrix.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left">
            <caption className="sr-only">Research gap matrix</caption>
            <thead>
              <tr className="text-[11px] font-medium text-neutral-500">
                {["Study", "Population", "Design", "Finding", "Limitation", "Gap"].map((h) => (
                  <th key={h} scope="col" className="border-b border-neutral-300 p-2">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {selected.map((citation, i) => {
                const profile = profileFor(citation.id);
                const rowGaps = gapsFor(citation.id);
                return (
                  <tr key={citation.id} className={i % 2 ? "bg-neutral-50" : ""}>
                    <th scope="row" className="p-2 align-top font-mono text-[11px] font-medium text-neutral-900">
                      [{citation.citation_key}]
                    </th>
                    <td className="p-2 align-top">{profile?.population ?? <Absent />}</td>
                    <td className="p-2 align-top">{profile?.study_design ?? <Absent />}</td>
                    <td className="p-2 align-top">{profile?.main_finding ?? <Absent />}</td>
                    <td className="p-2 align-top">{profile?.limitations ?? <Absent />}</td>
                    <td className="p-2 align-top">
                      {rowGaps.length === 0 ? (
                        <Absent />
                      ) : (
                        <ul className="space-y-1.5">
                          {rowGaps.map((gap) => (
                            <li key={gap.id}>
                              <p>{gap.gap_text}</p>
                              <div className="mt-0.5 flex flex-wrap items-center gap-1">
                                <span
                                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${BASIS_STYLE[gap.basis]}`}
                                >
                                  {GAP_BASIS_LABELS[gap.basis]}
                                </span>
                                <button
                                  type="button"
                                  disabled={busy}
                                  onClick={() => toggleVerified(gap)}
                                  className="rounded border border-neutral-300 px-1.5 py-0.5 text-[10px] disabled:opacity-40"
                                >
                                  {gap.verified ? "Verified ✓" : "Mark verified"}
                                </button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {unattributed.length > 0 && (
        <section aria-labelledby="cross-literature-gaps">
          <h4 id="cross-literature-gaps" className="mb-1 text-xs font-medium">
            Across the literature
          </h4>
          <ul className="space-y-1">
            {unattributed.map((gap) => (
              <li key={gap.id} className="rounded border border-neutral-200 p-2">
                <p>{gap.gap_text}</p>
                <span className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold ${BASIS_STYLE[gap.basis]}`}>
                  {GAP_BASIS_LABELS[gap.basis]}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {suggestions && suggestions.length > 0 && (
        <section aria-labelledby="suggested-gaps" className="rounded border border-dashed border-neutral-400 p-3">
          <h4 id="suggested-gaps" className="mb-2 text-xs font-medium">
            Suggested gaps
          </h4>
          <ul className="space-y-2">
            {suggestions.map((s, i) => (
              <li key={i} className="rounded border border-neutral-200 p-2">
                <p>{s.gap_text}</p>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${BASIS_STYLE[s.basis ?? "ai_inference"]}`}
                  >
                    {GAP_BASIS_LABELS[s.basis ?? "ai_inference"]}
                  </span>
                  {s.downgradedFrom && (
                    <span className="text-[10px] text-neutral-600">
                      proposed as “{GAP_BASIS_LABELS[s.downgradedFrom]}”; the source does not support that
                    </span>
                  )}
                </div>
                {s.supporting_text && (
                  <p className="mt-1 rounded bg-neutral-50 p-1.5 text-[11px] text-neutral-600">
                    “{s.supporting_text}”
                  </p>
                )}
                <div className="mt-1.5 flex gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => accept(s, i)}
                    className="rounded bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white disabled:opacity-40"
                  >
                    Add to matrix
                  </button>
                  <button
                    type="button"
                    onClick={() => setSuggestions((prev) => (prev ?? []).filter((_, j) => j !== i))}
                    className="rounded border border-neutral-300 px-2 py-1 text-[11px]"
                  >
                    Discard
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** A cell nobody has filled in. Visibly not content — see §20. */
function Absent() {
  return <span className="italic text-neutral-400">Not available in source</span>;
}
